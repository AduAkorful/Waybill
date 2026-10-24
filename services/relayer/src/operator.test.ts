import { describe, expect, test } from 'bun:test'

import { ARC_TESTNET } from '@waybill/network/networks'
import { handleApiRequest, type WaybillApiOptions } from './api'
import { ADMIN_EVENT_NAMES, PostgresOperatorStore, readOperatorChain } from './operator'

const who = `0x${'ab'.repeat(20)}` as `0x${string}`

function database(answers: Record<string, unknown[]>) {
  const calls: { text: string; values: readonly unknown[] }[] = []
  return {
    calls,
    query: async (text: string, values: readonly unknown[] = []) => {
      calls.push({ text, values })
      const key = Object.keys(answers).find((k) => text.includes(k))
      if (!key) throw new Error(`unexpected query ${text.slice(0, 40)}`)
      return { rows: answers[key] } as never
    },
  }
}

describe('operator index summary', () => {
  const db = () =>
    database({
      waybill_deal_projections: [{ state: 'FUNDED', deals: 3 }, { state: 'SETTLED', deals: 5 }],
      "event_name IN ('DealCreated'": [
        { event_name: 'DealCreated', label: null, is_test: null, deals: 4, amount: '4000000' },
        { event_name: 'DealFunded', label: null, is_test: null, deals: 2, amount: '2000000' },
        { event_name: 'DealCreated', label: 'self-dealing', is_test: true, deals: 6, amount: '600000.0000' },
        { event_name: 'DealFunded', label: 'self-dealing', is_test: true, deals: 6, amount: '600000' },
      ],
      "event_name = 'DisputeRaised'": [{ open: 2 }],
      waybill_relayer_cursors: [{ stream: 'escrow-indexer', block_number: '68143100', updated: '1800000000' }],
      'event_name = ANY($2::text[])\n  ORDER BY block_number DESC': [{ event_name: 'NewDealsPaused', block_number: '68000000', transaction_hash: `0x${'11'.repeat(32)}`, block_timestamp: '1799999000', payload: {} }],
    })

  test('groups volume by the operator’s label and keeps unlabelled deals separate', async () => {
    const s = await new PostgresOperatorStore(db()).summary('testnet', ['escrow-indexer'])
    const unlabelled = s.volume.find((v) => v.label === null)!
    const test = s.volume.find((v) => v.label === 'self-dealing')!
    expect(unlabelled).toMatchObject({ isTest: null, created: { deals: 4, amount: 4_000_000n }, funded: { deals: 2, amount: 2_000_000n } })
    expect(test).toMatchObject({ isTest: true, created: { deals: 6, amount: 600_000n } })
  })

  test('counts deals by state, open disputes, cursors and the admin log', async () => {
    const s = await new PostgresOperatorStore(db()).summary('testnet', ['escrow-indexer'])
    expect(s.dealsByState).toEqual({ FUNDED: 3, SETTLED: 5 })
    expect(s.openDisputes).toBe(2)
    expect(s.cursors).toEqual([{ stream: 'escrow-indexer', block: 68_143_100n, updatedAt: 1_800_000_000 }])
    expect(s.adminLog[0]).toMatchObject({ name: 'NewDealsPaused', block: 68_000_000n, time: 1_799_999_000 })
  })

  test('asks only for the events that change escrow settings, and parameterizes the network', async () => {
    const d = db()
    await new PostgresOperatorStore(d).summary('mainnet', ['a'])
    const log = d.calls.find((c) => c.text.includes('ORDER BY block_number DESC'))!
    expect(log.values[0]).toBe('mainnet')
    expect(log.values[1]).toEqual(ADMIN_EVENT_NAMES)
    expect(ADMIN_EVENT_NAMES).toContain('NewDealsPaused')
  })
})

describe('operator chain summary', () => {
  const client = (over: Record<string, unknown> = {}) =>
    ({
      readContract: async ({ functionName }: { functionName: string }) => {
        const values: Record<string, unknown> = { nextDealId: 281n, currentLocked: 5n, maxLocked: 100n, maxDealAmount: 50n, newDealsPaused: false, pauser: who, treasury: who, ...over }
        if (!(functionName in values)) throw new Error(`unexpected read ${functionName}`)
        return values[functionName]
      },
      getBalance: async () => 123n,
      getBlockNumber: async () => 999n,
    }) as never

  test('reads the live limits, pause state, pauser and the relayer’s gas balance', async () => {
    const s = await readOperatorChain(client(), ARC_TESTNET, who)
    expect(s).toMatchObject({ totalDeals: 281n, currentLocked: 5n, maxLocked: 100n, newDealsPaused: false, pauser: who, head: 999n })
    expect(s.relayer).toEqual({ address: who, gasBalance: 123n })
  })

  test('a failed read fails the whole summary', async () => {
    const broken = { readContract: async () => { throw new Error('rpc down') }, getBalance: async () => 0n, getBlockNumber: async () => 0n } as never
    await expect(readOperatorChain(broken, ARC_TESTNET, who)).rejects.toThrow('rpc down')
  })
})

describe('operator route', () => {
  const never = async () => {
    throw new Error('unused')
  }
  const base: WaybillApiOptions = { network: 'testnet', health: never as never, readDeal: never, readDealEvents: never, listAttestors: never, readAttestor: never, listWalletDeals: never }
  test('serves the summary with bigints as strings, and says so when it cannot', async () => {
    const ok = await handleApiRequest({ method: 'GET', url: '/v1/operator' }, { ...base, operatorSummary: async () => ({ chain: { currentLocked: 5n } }) })
    expect(ok.status).toBe(200)
    expect(ok.body).toEqual({ chain: { currentLocked: '5' } })
    expect((await handleApiRequest({ method: 'GET', url: '/v1/operator' }, base)).status).toBe(503)
    expect((await handleApiRequest({ method: 'GET', url: '/v1/operator' }, { ...base, operatorSummary: never })).status).toBe(503)
  })
})
