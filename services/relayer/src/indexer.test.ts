import { describe, expect, test } from 'bun:test'

import { ARC_TESTNET } from '../../../config/networks'
import { MemoryCursorStore } from './eligibility'
import {
  ChainEventIndexer,
  type IndexerLog,
  type IndexerLogReader,
  type ReadModelWriter,
} from './indexer'

const config = {
  network: ARC_TESTNET.network,
  contracts: ARC_TESTNET.contracts,
  startBlock: 10n,
  maxBlockRange: 20n,
  confirmations: 1 as const,
}

const txHash = `0x${'ab'.repeat(32)}` as `0x${string}`

function reader(head: bigint, logs: readonly IndexerLog[]): IndexerLogReader {
  return {
    getBlockNumber: async () => head,
    getLogs: async () => logs,
  }
}

class FakeWriter implements ReadModelWriter {
  events: unknown[] = []
  projections: unknown[] = []
  failProjection = false

  async recordEvent(event: unknown) {
    this.events.push(event)
    return true
  }

  async upsertDeal(projection: unknown) {
    if (this.failProjection) throw new Error('projection unavailable')
    this.projections.push(projection)
  }
}

const created: IndexerLog = {
  blockNumber: 10n,
  logIndex: 2n,
  transactionHash: txHash,
  eventName: 'DealCreated',
  args: {
    dealId: 4n,
    buyer: `0x${'11'.repeat(20)}`,
    supplier: `0x${'22'.repeat(20)}`,
    totalAmount: 1_000_000n,
    nested: { amount: 5n },
  },
}

describe('ChainEventIndexer', () => {
  test('indexes ordered lifecycle events and serializes BigInt payloads', async () => {
    const writer = new FakeWriter()
    const cursors = new MemoryCursorStore()
    const indexer = new ChainEventIndexer(
      reader(11n, [
        { ...created, logIndex: 4n, eventName: 'DealFunded', args: { dealId: 4n, totalAmount: 1_000_000n, prepaidFee: 1_000n } },
        created,
      ]),
      cursors,
      writer,
      config,
    )

    await expect(indexer.pollOnce()).resolves.toMatchObject({
      fromBlock: 10n,
      toBlock: 10n,
      scannedLogs: 2,
      projectedDeals: 2,
    })
    expect((writer.events[0] as { payload: Record<string, unknown> }).payload).toEqual({
      dealId: '4',
      buyer: `0x${'11'.repeat(20)}`,
      supplier: `0x${'22'.repeat(20)}`,
      totalAmount: '1000000',
      nested: { amount: '5' },
    })
    expect(writer.projections).toHaveLength(2)
  })

  test('resumes from a cursor and skips old logs', async () => {
    const writer = new FakeWriter()
    const cursors = new MemoryCursorStore()
    await cursors.set({ blockNumber: 10n, logIndex: 2n })
    const indexer = new ChainEventIndexer(
      reader(11n, [{ ...created, logIndex: 1n }, { ...created, logIndex: 3n }]),
      cursors,
      writer,
      config,
    )

    await indexer.pollOnce()
    expect(writer.events).toHaveLength(1)
    await expect(cursors.get()).resolves.toMatchObject({ blockNumber: 10n })
  })

  test('does not advance past a projection failure', async () => {
    const writer = new FakeWriter()
    writer.failProjection = true
    const cursors = new MemoryCursorStore()
    const indexer = new ChainEventIndexer(
      reader(11n, [created]),
      cursors,
      writer,
      config,
    )

    await expect(indexer.pollOnce()).rejects.toThrow('projection unavailable')
    await expect(cursors.get()).resolves.toBeNull()
  })

  test('uses the escrow address and confirmed range', async () => {
    let request: { address?: string; fromBlock?: bigint; toBlock?: bigint } = {}
    const source: IndexerLogReader = {
      getBlockNumber: async () => 100n,
      getLogs: async (parameters) => {
        request = parameters
        return []
      },
    }
    const indexer = new ChainEventIndexer(source, new MemoryCursorStore(), new FakeWriter(), config)
    await indexer.pollOnce()
    expect(request).toMatchObject({
      address: ARC_TESTNET.contracts.escrow,
      fromBlock: 10n,
      toBlock: 29n,
    })
  })
})
