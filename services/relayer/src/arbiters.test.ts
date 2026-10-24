import { describe, expect, test } from 'bun:test'

import { ARC_TESTNET } from '@waybill/network/networks'
import { handleApiRequest, type WaybillApiOptions } from './api'
import { ARBITER_EVENT_ABI, ARBITER_EVENT_NAMES, readArbiter } from './arbiters'
import { PostgresReadModelStore } from './read-model-store'

const who = `0x${'cd'.repeat(20)}` as `0x${string}`

function client(values: Record<string, unknown>) {
  return {
    readContract: async ({ functionName }: { functionName: string }) => {
      if (!(functionName in values)) throw new Error(`unexpected read ${functionName}`)
      return values[functionName]
    },
  } as never
}

describe('arbiter list reads', () => {
  test('declares the list events and names them the same way', () => {
    expect(ARBITER_EVENT_ABI.map((e) => e.name).sort()).toEqual([...ARBITER_EVENT_NAMES].sort())
  })

  test('reports an allowed arbiter with its advertised fee and nothing pending', async () => {
    const record = await readArbiter(client({ isAllowed: true, feeUsdc: 5_000_000n, getPendingAdd: [0n, 0n], getPendingRemove: 0n }), ARC_TESTNET, who)
    expect(record).toEqual({ address: who, allowed: true, fee: 5_000_000n, pendingAdd: null, pendingRemove: null })
  })

  test('reports scheduled additions and removals with their earliest times', async () => {
    const record = await readArbiter(client({ isAllowed: false, feeUsdc: 0n, getPendingAdd: [2_000_000n, 1_800_000_000n], getPendingRemove: 1_800_100_000n }), ARC_TESTNET, who)
    expect(record.pendingAdd).toEqual({ fee: 2_000_000n, eta: 1_800_000_000n })
    expect(record.pendingRemove).toEqual({ eta: 1_800_100_000n })
  })

  test('a failed read fails the whole record', async () => {
    await expect(readArbiter(client({ isAllowed: true, feeUsdc: 1n, getPendingAdd: [0n, 0n] }), ARC_TESTNET, who)).rejects.toThrow('unexpected read')
  })

  test('the store lists distinct arbiter addresses by event name', async () => {
    const calls: { text: string; values: readonly unknown[] }[] = []
    const store = new PostgresReadModelStore({
      query: async (text: string, values: readonly unknown[] = []) => {
        calls.push({ text, values })
        return { rows: [{ arbiter: who }] } as never
      },
    })
    expect(await store.listArbiterAddresses('testnet', ARBITER_EVENT_NAMES)).toEqual([who])
    expect(calls[0]!.text).toContain("payload->>'arbiter'")
    expect(calls[0]!.values).toEqual(['testnet', ARBITER_EVENT_NAMES])
  })

  test('the API serves the list, and says so when it cannot', async () => {
    const never = async () => {
      throw new Error('unused')
    }
    const base: WaybillApiOptions = { network: 'testnet', health: never as never, readDeal: never, readDealEvents: never, listAttestors: never, readAttestor: never, listWalletDeals: never }
    const ok = await handleApiRequest({ method: 'GET', url: '/v1/arbiters' }, { ...base, listArbiters: async () => [{ address: who, allowed: true, fee: 5n }] })
    expect(ok.status).toBe(200)
    expect(ok.body).toEqual([{ address: who, allowed: true, fee: '5' }])
    expect((await handleApiRequest({ method: 'GET', url: '/v1/arbiters' }, base)).status).toBe(503)
    expect((await handleApiRequest({ method: 'GET', url: '/v1/arbiters' }, { ...base, listArbiters: never })).status).toBe(503)
  })
})
