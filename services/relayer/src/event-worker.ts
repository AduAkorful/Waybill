import {
  RELAYER_SIGNAL_EVENTS,
  type RelayerChain,
  type RelayerCandidate,
  candidateFromSignal,
} from './chain'
import type { RelayerConfig } from './config'
import type { CursorStore, EventCursor } from './eligibility'

export const MAX_LOG_INDEX = (2n ** 256n) - 1n

export interface SignalLog {
  blockNumber: bigint
  logIndex: bigint
  eventName: string
  args?: Record<string, unknown>
}

export interface RelayerLogReader {
  getBlockNumber(): Promise<bigint>
  getLogs(parameters: {
    address: `0x${string}`
    events: typeof RELAYER_SIGNAL_EVENTS
    fromBlock: bigint
    toBlock: bigint
  }): Promise<readonly SignalLog[]>
}

export interface CandidateHandler {
  (candidate: RelayerCandidate): Promise<void>
}

export interface PollResult {
  fromBlock: bigint
  toBlock: bigint
  scannedLogs: number
  emittedCandidates: number
}

function compareLog(left: SignalLog, right: SignalLog): number {
  if (left.blockNumber !== right.blockNumber) {
    return left.blockNumber < right.blockNumber ? -1 : 1
  }
  if (left.logIndex === right.logIndex) return 0
  return left.logIndex < right.logIndex ? -1 : 1
}

function validateLog(log: SignalLog): void {
  if (log.blockNumber < 0n || log.logIndex < 0n) {
    throw new Error('Relayer event positions must be non-negative')
  }
  if (!log.eventName) throw new Error('Relayer event name cannot be empty')
}

function cursorFromLog(log: SignalLog): EventCursor {
  return { blockNumber: log.blockNumber, logIndex: log.logIndex }
}

export class RelayerEventWorker {
  constructor(
    private readonly reader: RelayerLogReader,
    private readonly cursorStore: CursorStore,
    private readonly config: Pick<RelayerConfig, 'network' | 'startBlock' | 'maxBlockRange' | 'confirmations'>,
    private readonly onCandidate: CandidateHandler,
  ) {}

  async pollOnce(): Promise<PollResult | null> {
    const head = await this.reader.getBlockNumber()
    const confirmations = BigInt(this.config.confirmations)
    const confirmedHead = head >= confirmations ? head - confirmations : 0n
    const current = await this.cursorStore.get()
    const resumedFrom =
      current && current.logIndex === MAX_LOG_INDEX
        ? current.blockNumber + 1n
        : current?.blockNumber
    const fromBlock = resumedFrom ?? this.config.startBlock

    if (fromBlock > confirmedHead) return null

    const toBlock =
      fromBlock + this.config.maxBlockRange - 1n < confirmedHead
        ? fromBlock + this.config.maxBlockRange - 1n
        : confirmedHead
    const logs = [...(await this.reader.getLogs({
      address: this.config.network.contracts.escrow,
      events: RELAYER_SIGNAL_EVENTS,
      fromBlock,
      toBlock,
    }))]
      .map((log) => {
        validateLog(log)
        return log
      })
      .sort(compareLog)

    let emittedCandidates = 0
    let previous = current
    for (const log of logs) {
      if (
        previous &&
        (log.blockNumber < previous.blockNumber ||
          (log.blockNumber === previous.blockNumber && log.logIndex <= previous.logIndex))
      ) {
        continue
      }

      const candidate = candidateFromSignal(log.eventName, log.args)
      if (!candidate) continue
      await this.onCandidate(candidate)
      await this.cursorStore.set(cursorFromLog(log))
      previous = cursorFromLog(log)
      emittedCandidates += 1
    }

    await this.cursorStore.set({ blockNumber: toBlock, logIndex: MAX_LOG_INDEX })
    return { fromBlock, toBlock, scannedLogs: logs.length, emittedCandidates }
  }
}

export function createRelayerLogReader(chain: RelayerChain): RelayerLogReader {
  return {
    getBlockNumber: () => chain.client.getBlockNumber(),
    async getLogs(parameters) {
      const logs = await chain.client.getLogs({
        address: parameters.address,
        events: parameters.events,
        fromBlock: parameters.fromBlock,
        toBlock: parameters.toBlock,
      })
      return logs.map((log) => ({
        blockNumber: log.blockNumber,
        logIndex: BigInt(log.logIndex),
        eventName: log.eventName,
        args: log.args as Record<string, unknown> | undefined,
      }))
    },
  }
}
