import { describe, expect, test } from 'bun:test'

import { ARC_TESTNET } from '../../../config/networks'
import { MemoryCursorStore } from './eligibility'
import {
  MAX_LOG_INDEX,
  RelayerEventWorker,
  type RelayerLogReader,
  type SignalLog,
} from './event-worker'

const config = {
  network: ARC_TESTNET,
  startBlock: 10n,
  maxBlockRange: 10n,
  confirmations: 1 as const,
}

function reader(head: bigint, logs: readonly SignalLog[]): RelayerLogReader {
  return {
    getBlockNumber: async () => head,
    getLogs: async () => logs,
  }
}

const claimable = (blockNumber: bigint, logIndex: bigint): SignalLog => ({
  blockNumber,
  logIndex,
  eventName: 'MilestoneClaimable',
  args: { dealId: 4n, milestoneIndex: 1n },
})

describe('RelayerEventWorker', () => {
  test('advances an empty range using the confirmed head', async () => {
    const cursors = new MemoryCursorStore()
    const worker = new RelayerEventWorker(reader(50n, []), cursors, config, async () => {})

    await expect(worker.pollOnce()).resolves.toEqual({
      fromBlock: 10n,
      toBlock: 19n,
      scannedLogs: 0,
      emittedCandidates: 0,
    })
    await expect(cursors.get()).resolves.toEqual({
      blockNumber: 19n,
      logIndex: MAX_LOG_INDEX,
    })
  })

  test('emits ordered candidates and persists the completed range', async () => {
    const cursors = new MemoryCursorStore()
    const candidates: bigint[] = []
    const worker = new RelayerEventWorker(
      reader(11n, [claimable(10n, 4n), claimable(10n, 2n)]),
      cursors,
      config,
      async (candidate) => {
        candidates.push(candidate.dealId)
      },
    )

    await expect(worker.pollOnce()).resolves.toMatchObject({
      scannedLogs: 2,
      emittedCandidates: 2,
    })
    expect(candidates).toEqual([4n, 4n])
    await expect(cursors.get()).resolves.toEqual({
      blockNumber: 10n,
      logIndex: MAX_LOG_INDEX,
    })
  })

  test('resumes after a same-block cursor without replaying older logs', async () => {
    const cursors = new MemoryCursorStore()
    await cursors.set({ blockNumber: 10n, logIndex: 2n })
    const candidates: bigint[] = []
    const worker = new RelayerEventWorker(
      reader(11n, [claimable(10n, 1n), claimable(10n, 3n)]),
      cursors,
      config,
      async (candidate) => {
        candidates.push(candidate.dealId)
      },
    )

    await worker.pollOnce()
    expect(candidates).toEqual([4n])
  })

  test('does not advance the cursor past a malformed event', async () => {
    const cursors = new MemoryCursorStore()
    const worker = new RelayerEventWorker(
      reader(11n, [{
        blockNumber: 10n,
        logIndex: 1n,
        eventName: 'MilestoneClaimable',
      }]),
      cursors,
      config,
      async () => {},
    )

    await expect(worker.pollOnce()).rejects.toThrow('Missing arguments')
    await expect(cursors.get()).resolves.toBeNull()
  })

  test('does not advance past a candidate whose handler fails', async () => {
    const cursors = new MemoryCursorStore()
    const worker = new RelayerEventWorker(
      reader(11n, [claimable(10n, 1n), claimable(10n, 2n)]),
      cursors,
      config,
      async (candidate) => {
        if (candidate.dealId === 4n) throw new Error('handler unavailable')
      },
    )

    await expect(worker.pollOnce()).rejects.toThrow('handler unavailable')
    await expect(cursors.get()).resolves.toBeNull()
  })

  test('returns no work before the first confirmed block', async () => {
    const cursors = new MemoryCursorStore()
    const worker = new RelayerEventWorker(reader(0n, []), cursors, config, async () => {})

    await expect(worker.pollOnce()).resolves.toBeNull()
    await expect(cursors.get()).resolves.toBeNull()
  })
})
