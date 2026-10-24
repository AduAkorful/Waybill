import {
  createPublicClient,
  defineChain,
  http,
  parseAbi,
  type PublicClient,
} from 'viem'

import type { WaybillNetworkManifest } from '../../../config/networks'
import type { RelayerOperation } from './config'

export const WAYBILL_READ_ABI = parseAbi([
  'function nextDealId() view returns (uint256)',
  'function getMilestone(uint256 dealId, uint8 milestoneIndex) view returns ((uint256 bps, uint8 condition, address attestor, uint64 deadline, uint32 gracePeriod, uint32 reviewWindow, uint8 state, bool attestorAccepted, bool attested, bytes32 evidenceHash, bool disputed, bool buyerRaisedDispute, uint64 reviewWindowStart, uint64 arbiterDeadline, uint8 threshold, uint8 attestCount, address disputeRaiser, uint64 disputeTime, bytes32 disputeEvidenceHash, uint64 responseDeadline, bytes32 responseHash, bool responseSubmitted) milestone)',
])

export const RELAYER_SIGNAL_EVENTS = parseAbi([
  'event MilestoneClaimable(uint256 indexed dealId, uint8 indexed milestoneIndex)',
  'event PayoutFailed(uint256 indexed dealId, uint8 indexed milestoneIndex, address recipient, uint256 amount)',
  'event MilestoneRefundable(uint256 indexed dealId, uint8 indexed milestoneIndex)',
  'event RefundFailed(uint256 indexed dealId, uint8 indexed milestoneIndex, address recipient, uint256 amount)',
  'event DisputeRaised(uint256 indexed dealId, uint8 indexed milestoneIndex, address raiser, bytes32 evidenceHash)',
])

export interface RelayerChain {
  client: PublicClient
  escrow: `0x${string}`
}

export interface MilestoneSnapshot {
  state: number
  deadline: bigint
  gracePeriod: number
  reviewWindow: number
  disputed: boolean
  responseDeadline: bigint
  arbiterDeadline: bigint
}

export interface RelayerCandidate {
  operation: RelayerOperation
  dealId: bigint
  milestoneIndex: number
  sourceEvent: string
  requiresEligibilityRecheck: true
}

function asBigInt(value: unknown, field: string): bigint {
  if (typeof value === 'bigint') return value
  if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value)
  if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value)
  throw new Error(`Invalid ${field} in relayer event`)
}

function asMilestoneIndex(value: unknown): number {
  const index = asBigInt(value, 'milestoneIndex')
  if (index > 255n) throw new Error('Invalid milestoneIndex in relayer event')
  return Number(index)
}

export function createRelayerChain(manifest: WaybillNetworkManifest): RelayerChain {
  const chain = defineChain({
    id: manifest.chainId,
    name: manifest.network === 'testnet' ? 'Arc Testnet' : 'Arc',
    nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
    rpcUrls: { default: { http: [manifest.rpcUrl] } },
  })

  return {
    client: createPublicClient({ chain, transport: http(manifest.rpcUrl) }) as PublicClient,
    escrow: manifest.contracts.escrow,
  }
}

type ReadContract = (parameters: {
  address: `0x${string}`
  abi: typeof WAYBILL_READ_ABI
  functionName: 'nextDealId' | 'getMilestone'
  args?: readonly unknown[]
}) => Promise<unknown>

export async function readNextDealId(chain: RelayerChain): Promise<bigint> {
  const readContract = chain.client.readContract as unknown as ReadContract
  return (await readContract({
    address: chain.escrow,
    abi: WAYBILL_READ_ABI,
    functionName: 'nextDealId',
  })) as bigint
}

export async function readMilestone(
  chain: RelayerChain,
  dealId: bigint,
  milestoneIndex: number,
): Promise<MilestoneSnapshot> {
  const readContract = chain.client.readContract as unknown as ReadContract
  const result = await readContract({
    address: chain.escrow,
    abi: WAYBILL_READ_ABI,
    functionName: 'getMilestone',
    args: [dealId, milestoneIndex],
  })
  const milestone = result as readonly unknown[] | Record<string, unknown>
  const value = (index: number, name: string): unknown =>
    Array.isArray(milestone) ? milestone[index] : milestone[name]

  return {
    state: Number(value(6, 'state')),
    deadline: asBigInt(value(3, 'deadline'), 'deadline'),
    gracePeriod: Number(value(4, 'gracePeriod')),
    reviewWindow: Number(value(5, 'reviewWindow')),
    disputed: Boolean(value(10, 'disputed')),
    responseDeadline: asBigInt(value(19, 'responseDeadline'), 'responseDeadline'),
    arbiterDeadline: asBigInt(value(20, 'arbiterDeadline'), 'arbiterDeadline'),
  }
}

export function candidateFromSignal(
  eventName: string,
  args: Record<string, unknown> | undefined,
): RelayerCandidate | null {
  if (!['MilestoneClaimable', 'PayoutFailed', 'MilestoneRefundable', 'RefundFailed', 'DisputeRaised'].includes(eventName)) {
    return null
  }
  if (!args) throw new Error(`Missing arguments for relayer event ${eventName}`)

  const operation: RelayerOperation =
    eventName === 'MilestoneClaimable' || eventName === 'PayoutFailed'
      ? 'claim'
      : eventName === 'MilestoneRefundable' || eventName === 'RefundFailed'
        ? 'refund'
        : 'applyDefault'

  return {
    operation,
    dealId: asBigInt(args.dealId, 'dealId'),
    milestoneIndex: asMilestoneIndex(args.milestoneIndex),
    sourceEvent: eventName,
    requiresEligibilityRecheck: true,
  }
}
