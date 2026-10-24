import { describe, expect, test } from 'bun:test'

import { ARC_TESTNET } from '@waybill/network/networks'
import {
  PostgresReadModelStore,
  type ChainEventRecord,
  type DealProjection,
} from './read-model-store'

class FakeDatabase {
  readonly calls: { text: string; values: readonly unknown[] }[] = []
  constructor(private readonly inserted: boolean = true) {}

  async query<Row>(text: string, values: readonly unknown[] = []) {
    this.calls.push({ text, values })
    return { rows: (text.includes('RETURNING') && this.inserted ? [{}] : []) as Row[] }
  }
}

const event: ChainEventRecord = {
  network: 'testnet',
  blockNumber: 12n,
  logIndex: 3n,
  transactionHash: `0x${'ef'.repeat(32)}`,
  eventName: 'DealCreated',
  dealId: 9n,
  milestoneIndex: 0,
  payload: { buyer: ARC_TESTNET.contracts.escrow },
}

const projection: DealProjection = {
  network: 'testnet',
  dealId: 9n,
  state: 'FUNDED',
  buyer: `0x${'11'.repeat(20)}`,
  supplier: `0x${'22'.repeat(20)}`,
  supplierPayout: `0x${'33'.repeat(20)}`,
  totalAmount: 1_000_000n,
  prepaidFee: 10_000n,
  lastBlockNumber: 12n,
  lastLogIndex: 3n,
}

describe('PostgresReadModelStore wallet deals', () => {
  const wallet = `0x${'AB'.repeat(20)}`

  test('records parties idempotently with lowercase addresses and -1 for whole-deal roles', async () => {
    const database = new FakeDatabase()
    await new PostgresReadModelStore(database).recordParties('testnet', 9n, [
      { address: wallet, role: 'buyer', milestoneIndex: null },
      { address: wallet, role: 'attestor', milestoneIndex: 2 },
    ])
    expect(database.calls[0]?.text).toContain('ON CONFLICT DO NOTHING')
    expect(database.calls[0]?.text).toContain('lower($3)')
    expect(database.calls.map((c) => c.values)).toEqual([
      ['testnet', '9', wallet, 'buyer', -1],
      ['testnet', '9', wallet, 'attestor', 2],
    ])
    await expect(
      new PostgresReadModelStore(database).recordParties('testnet', 9n, [{ address: 'nope', role: 'buyer', milestoneIndex: null }]),
    ).rejects.toThrow('Invalid party address')
  })

  test('groups a wallet\'s roles by deal, newest first', async () => {
    const database = {
      async query<Row>() {
        return {
          rows: [
            { deal_id: '9', role: 'attestor', milestone_index: 0, state: 'FUNDED' },
            { deal_id: '9', role: 'buyer', milestone_index: -1, state: 'FUNDED' },
            { deal_id: '4', role: 'supplier', milestone_index: -1, state: null },
          ] as Row[],
        }
      },
    }
    expect(await new PostgresReadModelStore(database).getWalletDeals('testnet', wallet)).toEqual([
      { dealId: 9n, state: 'FUNDED', roles: [{ role: 'attestor', milestoneIndex: 0 }, { role: 'buyer', milestoneIndex: null }] },
      { dealId: 4n, state: null, roles: [{ role: 'supplier', milestoneIndex: null }] },
    ])
    await expect(new PostgresReadModelStore(database).getWalletDeals('testnet', 'x')).rejects.toThrow('Invalid wallet address')
  })
})

describe('PostgresReadModelStore attestors', () => {
  const names = ['ProfileUpdated', 'OutcomeRecorded']

  test('lists registry attestors scoped to the network and the registry event names', async () => {
    const database = {
      calls: [] as { text: string; values: readonly unknown[] }[],
      async query<Row>(text: string, values: readonly unknown[] = []) {
        this.calls.push({ text, values })
        return { rows: [{ attestor: `0x${'ab'.repeat(20)}` }] as Row[] }
      },
    }
    const out = await new PostgresReadModelStore(database).listAttestorAddresses('testnet', names)
    expect(out).toEqual([`0x${'ab'.repeat(20)}`])
    expect(database.calls[0]?.values).toEqual(['testnet', names])
    expect(database.calls[0]?.text).toContain('event_name = ANY($2::text[])')
  })

  test('reads one attestor history oldest first and rejects a malformed address before querying', async () => {
    const database = {
      calls: [] as { text: string; values: readonly unknown[] }[],
      async query<Row>(text: string, values: readonly unknown[] = []) {
        this.calls.push({ text, values })
        return { rows: [] as Row[] }
      },
    }
    const store = new PostgresReadModelStore(database)
    await store.getAttestorEvents('testnet', `0x${'ab'.repeat(20)}`, names)
    expect(database.calls[0]?.values).toEqual(['testnet', names, `0x${'ab'.repeat(20)}`])
    expect(database.calls[0]?.text).toContain('ORDER BY block_number ASC, log_index ASC')
    await expect(store.getAttestorEvents('testnet', "0x1'; drop", names)).rejects.toThrow('Invalid attestor address')
    expect(database.calls).toHaveLength(1)
  })
})

describe('PostgresReadModelStore events', () => {
  test('stores the block time when given and rejects a negative one', async () => {
    const database = new FakeDatabase()
    const store = new PostgresReadModelStore(database)
    await store.recordEvent({ ...event, blockTimestamp: 1_700_000_000n })
    expect(database.calls[0]?.values.at(-1)).toBe('1700000000')
    await expect(store.recordEvent({ ...event, blockTimestamp: -1n })).rejects.toThrow('blockTimestamp')
  })

  test('reads a deal events oldest first, scoped to the network', async () => {
    const database = {
      calls: [] as { text: string; values: readonly unknown[] }[],
      async query<Row>(text: string, values: readonly unknown[] = []) {
        this.calls.push({ text, values })
        return {
          rows: [
            {
              block_number: '12',
              log_index: '3',
              transaction_hash: event.transactionHash,
              event_name: 'DealCreated',
              milestone_index: null,
              block_timestamp: '1700000000',
              payload: { totalAmount: '1000000' },
            },
            {
              block_number: '13',
              log_index: '0',
              transaction_hash: event.transactionHash,
              event_name: 'DealFunded',
              milestone_index: null,
              block_timestamp: null,
              payload: {},
            },
          ] as Row[],
        }
      },
    }
    const events = await new PostgresReadModelStore(database).getDealEvents('testnet', 9n)
    expect(database.calls[0]?.values).toEqual(['testnet', '9'])
    expect(database.calls[0]?.text).toContain('ORDER BY block_number ASC, log_index ASC')
    expect(events.map((e) => e.eventName)).toEqual(['DealCreated', 'DealFunded'])
    expect(events[0]?.blockTimestamp).toBe(1_700_000_000n)
    expect(events[1]?.blockTimestamp).toBeNull()
    await expect(new PostgresReadModelStore(database).getDealEvents('testnet', -1n)).rejects.toThrow('non-negative')
  })
})

describe('PostgresReadModelStore', () => {
  test('records chain events idempotently and parameterizes payloads', async () => {
    const database = new FakeDatabase()
    const store = new PostgresReadModelStore(database)

    await expect(store.recordEvent(event)).resolves.toBe(true)
    const call = database.calls[0]
    expect(call?.values).toEqual([
      'testnet',
      '12',
      '3',
      `0x${'ef'.repeat(32)}`,
      'DealCreated',
      '9',
      0,
      JSON.stringify(event.payload),
      null,
    ])
    expect(call?.text).not.toContain('DealCreated')
  })

  test('returns false for a duplicate event and upserts deal projections monotonically', async () => {
    const database = new FakeDatabase(false)
    const store = new PostgresReadModelStore(database)

    await expect(store.recordEvent(event)).resolves.toBe(false)
    await expect(store.upsertDeal(projection)).resolves.toBeUndefined()
    expect(database.calls[1]?.values).toEqual([
      'testnet',
      '9',
      'FUNDED',
      projection.buyer,
      projection.supplier,
      projection.supplierPayout,
      '1000000',
      '10000',
      '12',
      '3',
    ])
    expect(database.calls[1]?.text).not.toContain('FUNDED')
  })

  test('rejects malformed positions, hashes, addresses, and bigint payloads', async () => {
    const store = new PostgresReadModelStore(new FakeDatabase())
    await expect(store.recordEvent({ ...event, logIndex: -1n })).rejects.toThrow('non-negative')
    await expect(store.recordEvent({ ...event, transactionHash: '0x12' })).rejects.toThrow(
      'transaction hash',
    )
    await expect(store.upsertDeal({ ...projection, buyer: '0x12' })).rejects.toThrow('buyer')
    await expect(store.recordEvent({ ...event, payload: { amount: 1n } })).rejects.toThrow(
      'BigInt',
    )
  })
})
