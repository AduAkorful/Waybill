import { describe, expect, test } from 'bun:test'

import { ARC_TESTNET } from '../../../config/networks'
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
