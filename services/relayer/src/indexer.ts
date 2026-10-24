import {
  type Abi,
  parseAbi,
  parseEventLogs,
  type PublicClient,
} from 'viem'

import type { WaybillNetworkManifest } from '@waybill/network/networks'
import type { CursorStore, EventCursor } from './eligibility'
import { MAX_LOG_INDEX } from './event-worker'
import type { RelayerChain } from './chain'
import { readDealParties, type DealParty } from './parties'
import type { DealProjection, ChainEventRecord, PostgresReadModelStore } from './read-model-store'

export const INDEXER_EVENT_ABI = parseAbi([
  'event DealCreated(uint256 indexed dealId, address indexed buyer, address indexed supplier, address arbiter, uint256 totalAmount, uint16 feeBps)',
  'event SupplierAccepted(uint256 indexed dealId, address supplier, address payoutAddress)',
  'event AttestorAccepted(uint256 indexed dealId, uint8 milestoneIndex, address attestor)',
  'event ArbiterAccepted(uint256 indexed dealId, address arbiter)',
  'event DealFunded(uint256 indexed dealId, uint256 totalAmount, uint256 prepaidFee)',
  'event AttestationSubmitted(uint256 indexed dealId, uint8 indexed milestoneIndex, address attestor, bytes32 evidenceHash)',
  'event ThresholdMet(uint256 indexed dealId, uint8 indexed milestoneIndex, uint8 threshold)',
  'event ReviewWindowStarted(uint256 indexed dealId, uint8 indexed milestoneIndex, uint64 startedAt, uint32 windowHours)',
  'event MilestoneApprovedEarly(uint256 indexed dealId, uint8 indexed milestoneIndex)',
  'event MilestoneClaimable(uint256 indexed dealId, uint8 milestoneIndex)',
  'event TrancheClaimed(uint256 indexed dealId, uint8 indexed milestoneIndex, address recipient, uint256 amount)',
  'event PayoutFailed(uint256 indexed dealId, uint8 indexed milestoneIndex, address recipient, uint256 amount)',
  'event DisputeRaised(uint256 indexed dealId, uint8 indexed milestoneIndex, address raiser, bytes32 evidenceHash)',
  'event DisputeResponseAdded(uint256 indexed dealId, uint8 indexed milestoneIndex, address responder, bytes32 evidenceHash)',
  'event DisputeEvidenceAppended(uint256 indexed dealId, uint8 indexed milestoneIndex, address indexed submitter, bytes32 evidenceHash, uint256 index)',
  'event DisputeWithdrawn(uint256 indexed dealId, uint8 indexed milestoneIndex, address buyer)',
  'event DisputeResolved(uint256 indexed dealId, uint8 indexed milestoneIndex, address arbiter, bool toSupplier)',
  'event TrancheSplit(uint256 indexed dealId, uint8 indexed milestoneIndex, uint16 supplierBps, uint256 supplierAmount, uint256 buyerAmount)',
  'event DefaultApplied(uint256 indexed dealId, uint8 indexed milestoneIndex, bool toSupplier)',
  'event TrancheRefunded(uint256 indexed dealId, uint8 indexed milestoneIndex, address recipient, uint256 amount, uint256 feeRefunded)',
  'event RefundFailed(uint256 indexed dealId, uint8 indexed milestoneIndex, address recipient, uint256 amount)',
  'event CascadeRefunded(uint256 indexed dealId, uint8 indexed milestoneIndex, address recipient, uint256 amount, uint256 feeRefunded)',
  'event CascadeRefundPending(uint256 indexed dealId, uint8 indexed milestoneIndex, address blockedRecipient, uint256 amount)',
  'event CascadeRefundRetried(uint256 indexed dealId, uint8 indexed milestoneIndex, address recipient, uint256 amount)',
  'event MilestoneRefundable(uint256 indexed dealId, uint8 milestoneIndex)',
  'event DealSettled(uint256 indexed dealId)',
  'event DealCancelled(uint256 indexed dealId)',
  'event FeesWithdrawn(address indexed recipient, uint256 amount)',
  'event ArbiterFeeCredited(uint256 indexed dealId, address indexed arbiter, uint256 amount)',
  'event ArbiterFeeRefunded(uint256 indexed dealId, address indexed recipient, uint256 amount)',
  'event ArbiterFeeRefundPending(uint256 indexed dealId, address indexed blockedRecipient, uint256 amount)',
  'event PanelMemberAccepted(uint256 indexed dealId, address indexed member)',
  'event PanelVoteCast(uint256 indexed dealId, uint8 indexed milestoneIndex, address indexed member, uint32 vote)',
  'event PanelResolved(uint256 indexed dealId, uint8 indexed milestoneIndex, uint32 winningVote)',
  'event NewDealsPaused()',
  'event NewDealsUnpaused()',
  'event ArbiterAdded(address indexed arbiter)',
  'event ArbiterRemoved(address indexed arbiter)',
  'event AddArbiterScheduled(address indexed arbiter, uint64 eta)',
  'event AddArbiterExecuted(address indexed arbiter)',
  'event RemoveArbiterScheduled(address indexed arbiter, uint64 eta)',
  'event RemoveArbiterExecuted(address indexed arbiter)',
  'event SetTreasuryScheduled(address indexed proposed, uint64 eta)',
  'event SetTreasuryExecuted(address indexed oldTreasury, address indexed newTreasury)',
  'event SetFeeBpsRangeScheduled(uint16 minBps, uint16 maxBps, uint64 eta)',
  'event SetFeeBpsRangeExecuted(uint16 minBps, uint16 maxBps)',
  'event PayoutChangeProposed(uint256 indexed dealId, address oldAddr, address newAddr, uint64 eta)',
  'event PayoutChangeRejected(uint256 indexed dealId, address rejected)',
  'event PayoutChangeApplied(uint256 indexed dealId, address oldAddr, address newAddr)',
  'event RefundChangeProposed(uint256 indexed dealId, address oldAddr, address newAddr, uint64 eta)',
  'event RefundChangeRejected(uint256 indexed dealId, address rejected)',
  'event RefundChangeApplied(uint256 indexed dealId, address oldAddr, address newAddr)',
])

export interface IndexerLog {
  blockNumber: bigint
  logIndex: bigint
  transactionHash: `0x${string}`
  eventName: string
  args?: Record<string, unknown>
}

export interface IndexerLogReader {
  getBlockNumber(): Promise<bigint>
  /** Unix seconds of a block. Optional so a reader without it records events with no time. */
  getBlockTimestamp?(blockNumber: bigint): Promise<bigint>
  /** Everyone the escrow names in a deal, read at the block it was created in. */
  getDealParties?(dealId: bigint, blockNumber: bigint): Promise<readonly DealParty[]>
  getLogs(parameters: {
    address: `0x${string}`
    events: Abi
    fromBlock: bigint
    toBlock: bigint
  }): Promise<readonly IndexerLog[]>
}

export interface ReadModelWriter {
  recordEvent(event: ChainEventRecord): Promise<boolean>
  recordParties?(
    network: WaybillNetworkManifest['network'],
    dealId: bigint,
    parties: readonly DealParty[],
  ): Promise<void>
  upsertDeal(projection: DealProjection): Promise<void>
}

export interface IndexerResult {
  fromBlock: bigint
  toBlock: bigint
  scannedLogs: number
  projectedDeals: number
}

function compareLog(left: IndexerLog, right: IndexerLog): number {
  if (left.blockNumber !== right.blockNumber) return left.blockNumber < right.blockNumber ? -1 : 1
  if (left.logIndex === right.logIndex) return 0
  return left.logIndex < right.logIndex ? -1 : 1
}

function asBigInt(value: unknown, field: string): bigint {
  if (typeof value === 'bigint') return value
  if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value)
  throw new Error(`Invalid ${field} in indexed event`)
}

function asAddress(value: unknown, field: string): `0x${string}` {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`Invalid ${field} in indexed event`)
  }
  return value as `0x${string}`
}

function serialize(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString()
  if (Array.isArray(value)) return value.map(serialize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, serialize(child)]),
    )
  }
  return value
}

function projectionFor(
  network: WaybillNetworkManifest['network'],
  log: IndexerLog,
): DealProjection | null {
  if (!log.args) return null
  const dealIdValue = log.args.dealId
  if (dealIdValue === undefined) return null
  const dealId = asBigInt(dealIdValue, 'dealId')
  if (log.eventName === 'DealCreated') {
    return {
      network,
      dealId,
      state: 'CREATED',
      buyer: asAddress(log.args.buyer, 'buyer'),
      supplier: asAddress(log.args.supplier, 'supplier'),
      totalAmount: asBigInt(log.args.totalAmount, 'totalAmount'),
      lastBlockNumber: log.blockNumber,
      lastLogIndex: log.logIndex,
    }
  }
  if (log.eventName === 'DealFunded') {
    return {
      network,
      dealId,
      state: 'FUNDED',
      totalAmount: asBigInt(log.args.totalAmount, 'totalAmount'),
      prepaidFee: asBigInt(log.args.prepaidFee, 'prepaidFee'),
      lastBlockNumber: log.blockNumber,
      lastLogIndex: log.logIndex,
    }
  }
  if (log.eventName === 'DealSettled' || log.eventName === 'DealCancelled') {
    return {
      network,
      dealId,
      state: log.eventName === 'DealSettled' ? 'SETTLED' : 'CANCELLED',
      lastBlockNumber: log.blockNumber,
      lastLogIndex: log.logIndex,
    }
  }
  return null
}

export class ChainEventIndexer {
  constructor(
    private readonly reader: IndexerLogReader,
    private readonly cursorStore: CursorStore,
    private readonly writer: ReadModelWriter | PostgresReadModelStore,
    private readonly config: Pick<
      WaybillNetworkManifest & { startBlock: bigint; maxBlockRange: bigint; confirmations: 1 },
      'network' | 'contracts' | 'startBlock' | 'maxBlockRange' | 'confirmations'
    > & {
      /** Index another contract's events instead of the escrow's (for example the attestor registry) */
      target?: { address: `0x${string}`; events: Abi }
    },
  ) {}

  async pollOnce(): Promise<IndexerResult | null> {
    const head = await this.reader.getBlockNumber()
    const confirmedHead = head > 0n ? head - 1n : 0n
    const current = await this.cursorStore.get()
    const fromBlock =
      current && current.logIndex === MAX_LOG_INDEX
        ? current.blockNumber + 1n
        : current?.blockNumber ?? this.config.startBlock
    if (fromBlock > confirmedHead) return null
    const toBlock =
      fromBlock + this.config.maxBlockRange - 1n < confirmedHead
        ? fromBlock + this.config.maxBlockRange - 1n
        : confirmedHead
    const logs = [...(await this.reader.getLogs({
      address: this.config.target?.address ?? this.config.contracts.escrow,
      events: this.config.target?.events ?? INDEXER_EVENT_ABI,
      fromBlock,
      toBlock,
    }))].sort(compareLog)

    const timestamps = new Map<bigint, bigint>()
    if (this.reader.getBlockTimestamp) {
      for (const blockNumber of new Set(logs.map((log) => log.blockNumber))) {
        timestamps.set(blockNumber, await this.reader.getBlockTimestamp(blockNumber))
      }
    }

    let projectedDeals = 0
    let previous = current
    for (const log of logs) {
      if (
        previous &&
        (log.blockNumber < previous.blockNumber ||
          (log.blockNumber === previous.blockNumber && log.logIndex <= previous.logIndex))
      ) continue
      const payload = (serialize(log.args ?? {}) ?? {}) as Record<string, unknown>
      await this.writer.recordEvent({
        network: this.config.network,
        blockNumber: log.blockNumber,
        logIndex: log.logIndex,
        transactionHash: log.transactionHash,
        eventName: log.eventName,
        dealId: log.args?.dealId === undefined ? undefined : asBigInt(log.args.dealId, 'dealId'),
        milestoneIndex:
          log.args?.milestoneIndex === undefined
            ? undefined
            : Number(asBigInt(log.args.milestoneIndex, 'milestoneIndex')),
        blockTimestamp: timestamps.get(log.blockNumber),
        payload,
      })
      if (log.eventName === 'DealCreated' && this.reader.getDealParties && this.writer.recordParties) {
        // A failure here stops the poll before the cursor moves, so the deal is retried, never skipped.
        const dealId = asBigInt(log.args?.dealId, 'dealId')
        await this.writer.recordParties(
          this.config.network,
          dealId,
          await this.reader.getDealParties(dealId, log.blockNumber),
        )
      }
      const projection = projectionFor(this.config.network, log)
      if (projection) {
        await this.writer.upsertDeal(projection)
        projectedDeals += 1
      }
      await this.cursorStore.set({ blockNumber: log.blockNumber, logIndex: log.logIndex })
      previous = { blockNumber: log.blockNumber, logIndex: log.logIndex }
    }
    await this.cursorStore.set({ blockNumber: toBlock, logIndex: MAX_LOG_INDEX })
    return { fromBlock, toBlock, scannedLogs: logs.length, projectedDeals }
  }
}

export function createIndexerLogReader(
  chain: RelayerChain,
): IndexerLogReader {
  const client = chain.client as PublicClient
  return {
    getBlockNumber: () => client.getBlockNumber(),
    getDealParties: (dealId, blockNumber) => readDealParties(chain, dealId, blockNumber),
    async getBlockTimestamp(blockNumber) {
      return (await client.getBlock({ blockNumber })).timestamp
    },
    async getLogs(parameters) {
      // The public Arc RPC answers "requested range too large" to any filter that lists about 30 or
      // more event topics, however short the block range. Fetch by address and decode here instead.
      const raw = await client.getLogs({
        address: parameters.address,
        fromBlock: parameters.fromBlock,
        toBlock: parameters.toBlock,
      })
      const logs = parseEventLogs({ abi: parameters.events, logs: raw })
      return logs.map((log) => ({
        blockNumber: log.blockNumber,
        logIndex: BigInt(log.logIndex),
        transactionHash: log.transactionHash,
        eventName: log.eventName,
        args: log.args as Record<string, unknown> | undefined,
      }))
    },
  }
}
