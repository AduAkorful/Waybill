import type { Address, Hex } from 'viem'

/** Contract enums, as the words the UI switches on. Order matches IWaybillEscrow. */
export const DEAL_STATES = ['proposed', 'accepted', 'funded', 'settled', 'cancelled'] as const
export type DealState = (typeof DEAL_STATES)[number]

export const MILESTONE_STATES = [
  'waiting',
  'in_review',
  'claimable',
  'released',
  'overdue',
  'refundable',
  'refunded',
  'disputed',
  'resolved',
] as const
export type MilestoneState = (typeof MILESTONE_STATES)[number]

export const CONDITIONS = ['acceptance', 'attestation', 'buyer_approval', 'timed'] as const
export type Condition = (typeof CONDITIONS)[number]

export const FEE_PAYERS = ['buyer', 'supplier', 'split'] as const
export type FeePayer = (typeof FEE_PAYERS)[number]

/**
 * One part ("stub") of a deal, read from the escrow. Amounts are raw 6-decimal USDC units.
 * `position` is the contract's zero-based index; `index` is the number people see.
 */
export interface Tranche {
  position: number
  index: number
  bps: number
  amount: bigint
  /** The full protocol fee on this part, whoever pays it */
  fee: bigint
  condition: Condition
  attestor: Address | null
  threshold: number
  attestCount: number
  attestorAccepted: boolean
  attested: boolean
  state: MilestoneState
  /** Unix seconds */
  deadline: bigint
  gracePeriod: number
  reviewWindow: number
  reviewWindowStart: bigint
  evidenceHash: Hex | null
  disputed: boolean
  buyerRaisedDispute: boolean
  disputeRaiser: Address | null
  disputeTime: bigint
  responseDeadline: bigint
  responseSubmitted: boolean
  arbiterDeadline: bigint
  /** From off-chain terms, only when the relayer provides them */
  title?: string
}

/** Details that live off-chain (the contract stores none of them). Absent until the relayer serves them. */
export interface DealTerms {
  goods?: string
  units?: number
  cartons?: number
  origin?: { code: string; city: string }
  destination?: { code: string; city: string }
  template?: string
  buyerName?: string
  supplierName?: string
  milestoneTitles?: string[]
}

/** One indexed escrow event, served by the relayer. Amounts are raw 6-decimal USDC units. */
export interface DealEvent {
  name: string
  /** Part position, when the event is about one part */
  position: number | null
  blockNumber: bigint
  logIndex: bigint
  txHash: Hex
  /** Unix seconds; null when the indexer did not record the block time */
  time: bigint | null
  /** Decoded event arguments, as strings for numbers and addresses */
  args: Record<string, unknown>
}

/** How the arbiter split one part, read from the TrancheSplit event (the escrow keeps no record). */
export interface SplitDecision {
  position: number
  supplierBps: number
  /** What the supplier received (net of fee deducted from them) */
  supplierAmount: bigint
  /** Principal returned to the buyer, before the buyer's prepaid-fee share */
  buyerPrincipal: bigint
}

export interface DealView {
  id: bigint
  buyer: Address
  supplier: Address
  /** Zero until the supplier accepts */
  supplierPayout: Address | null
  buyerRefund: Address
  arbiter: Address
  state: DealState
  totalAmount: bigint
  /** What the buyer deposits toward fees at funding (depends on who pays) */
  prepaidFee: bigint
  feeBps: number
  feePayer: FeePayer
  arbiterFee: bigint
  arbiterAccepted: boolean
  fundFirst: boolean
  settled: boolean
  /** Unix seconds */
  acceptanceDeadline: bigint
  responsePeriodHours: number
  tranches: Tranche[]
  /** Latest block time the data was read at, unix seconds */
  chainTime: bigint
  terms?: DealTerms
  /** Indexed history, oldest first. Absent until the relayer's events were read. */
  events?: DealEvent[]
  /** Arbiter splits found in `events`. Absent when events were not read. */
  splits?: SplitDecision[]
}
