import { describe, expect, test } from 'bun:test'

import { encodeEventTopics } from 'viem'
import { ARC_TESTNET } from '@waybill/network/networks'
import { MemoryCursorStore } from './eligibility'
import {
  ChainEventIndexer,
  createIndexerLogReader,
  INDEXER_EVENT_ABI,
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

describe('indexer block times', () => {
  const log = (blockNumber: bigint, logIndex: bigint): IndexerLog => ({
    blockNumber,
    logIndex,
    transactionHash: txHash,
    eventName: 'DealSettled',
    args: { dealId: 1n },
  })

  test('records each event with its block time, reading each block once', async () => {
    const reads: bigint[] = []
    const writer = new FakeWriter()
    const indexer = new ChainEventIndexer(
      {
        ...reader(100n, [log(10n, 0n), log(10n, 1n), log(11n, 0n)]),
        getBlockTimestamp: async (block) => {
          reads.push(block)
          return 1_000n + block
        },
      },
      new MemoryCursorStore(),
      writer,
      config,
    )
    await indexer.pollOnce()
    expect(reads.sort()).toEqual([10n, 11n])
    expect((writer.events as { blockTimestamp?: bigint }[]).map((e) => e.blockTimestamp)).toEqual([
      1_010n,
      1_010n,
      1_011n,
    ])
  })

  test('records no time when the reader cannot supply one', async () => {
    const writer = new FakeWriter()
    await new ChainEventIndexer(reader(100n, [log(10n, 0n)]), new MemoryCursorStore(), writer, config).pollOnce()
    expect((writer.events as { blockTimestamp?: bigint }[])[0]?.blockTimestamp).toBeUndefined()
  })
})

describe('indexer log reader', () => {
  test('asks the RPC for the address only and decodes known events itself', async () => {
    const topics = encodeEventTopics({ abi: INDEXER_EVENT_ABI, eventName: 'DealSettled', args: { dealId: 7n } })
    const calls: Record<string, unknown>[] = []
    const chain = {
      escrow: ARC_TESTNET.contracts.escrow,
      client: {
        getLogs: async (parameters: Record<string, unknown>) => {
          calls.push(parameters)
          return [
            { address: ARC_TESTNET.contracts.escrow, blockNumber: 12n, logIndex: 3, transactionHash: txHash, topics, data: '0x', blockHash: txHash, transactionIndex: 0, removed: false },
            // not an escrow event: must be ignored, not fail the batch
            { address: ARC_TESTNET.contracts.escrow, blockNumber: 12n, logIndex: 4, transactionHash: txHash, topics: [`0x${'11'.repeat(32)}`], data: '0x', blockHash: txHash, transactionIndex: 0, removed: false },
          ]
        },
      },
    }
    const logs = await createIndexerLogReader(chain as never).getLogs({
      address: ARC_TESTNET.contracts.escrow,
      events: INDEXER_EVENT_ABI,
      fromBlock: 10n,
      toBlock: 20n,
    })
    // the public RPC rejects filters listing many topics, so none may be sent
    expect(calls[0]).not.toHaveProperty('events')
    expect(calls[0]).not.toHaveProperty('topics')
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({ blockNumber: 12n, logIndex: 3n, eventName: 'DealSettled', args: { dealId: 7n } })
  })
})

describe('indexer target override', () => {
  test('reads the named contract and events instead of the escrow', async () => {
    const seen: { address?: string; events?: unknown }[] = []
    const registry = `0x${'5d'.repeat(20)}` as `0x${string}`
    const events = [{ type: 'event', name: 'ProfileUpdated', inputs: [] }] as never
    const indexer = new ChainEventIndexer(
      { getBlockNumber: async () => 100n, getLogs: async (p) => { seen.push(p); return [] } },
      new MemoryCursorStore(),
      new FakeWriter(),
      { ...config, target: { address: registry, events } },
    )
    await indexer.pollOnce()
    expect(seen[0]?.address).toBe(registry)
    expect(seen[0]?.events).toBe(events)
  })
})

describe('indexer parties', () => {
  const party = { address: `0x${'11'.repeat(20)}` as `0x${string}`, role: 'buyer' as const, milestoneIndex: null }
  const created: IndexerLog = { blockNumber: 12n, logIndex: 0n, transactionHash: txHash, eventName: 'DealCreated', args: { dealId: 5n, buyer: party.address, supplier: party.address, totalAmount: 1n } }

  test('records a deal\'s parties from its creation block before moving the cursor', async () => {
    const reads: [bigint, bigint][] = []
    const recorded: unknown[] = []
    const cursor = new MemoryCursorStore()
    const writer = Object.assign(new FakeWriter(), { recordParties: async (_n: unknown, id: bigint, p: unknown) => { recorded.push([id, p]) } })
    await new ChainEventIndexer(
      { ...reader(100n, [created]), getDealParties: async (id, block) => { reads.push([id, block]); return [party] } },
      cursor,
      writer,
      config,
    ).pollOnce()
    expect(reads).toEqual([[5n, 12n]])
    expect(recorded).toEqual([[5n, [party]]])
  })

  test('stops before the cursor moves when the parties cannot be read, so the deal is retried', async () => {
    const cursor = new MemoryCursorStore()
    const writer = Object.assign(new FakeWriter(), { recordParties: async () => {} })
    const indexer = new ChainEventIndexer(
      { ...reader(100n, [created]), getDealParties: async () => { throw new Error('rpc') } },
      cursor,
      writer,
      config,
    )
    await expect(indexer.pollOnce()).rejects.toThrow('rpc')
    expect(await cursor.get()).toBeNull()
  })
})
