import {
  encodeFunctionData,
  type Abi,
  type Hex,
  type PublicClient,
  type WalletClient,
} from 'viem'
import { getBrowserNetwork } from './network'
import type { WaybillNetworkManifest } from '@waybill/network/networks'

export const WAYBILL_ESCROW_ABI = [
  {
    type: 'function',
    name: 'getDeal',
    stateMutability: 'view',
    inputs: [{ name: 'dealId', type: 'uint256' }],
    outputs: [{
      name: 'deal',
      type: 'tuple',
      components: [
        { name: 'buyer', type: 'address' },
        { name: 'supplier', type: 'address' },
        { name: 'supplierPayout', type: 'address' },
        { name: 'buyerRefund', type: 'address' },
        { name: 'arbiter', type: 'address' },
        { name: 'state', type: 'uint8' },
        { name: 'totalAmount', type: 'uint256' },
        { name: 'prepaidFee', type: 'uint256' },
        { name: 'feeBps', type: 'uint16' },
        { name: 'milestoneCount', type: 'uint8' },
        { name: 'acceptanceDeadline', type: 'uint64' },
        { name: 'arbiterDeadlineHours', type: 'uint64' },
        { name: 'arbiterAccepted', type: 'bool' },
        { name: 'newDealPaused', type: 'bool' },
        { name: 'settled', type: 'bool' },
        { name: 'responsePeriodHours', type: 'uint32' },
        { name: 'protocolTreasury', type: 'address' },
        { name: 'fundFirst', type: 'bool' },
        { name: 'arbiterFee', type: 'uint256' },
        { name: 'feePayer', type: 'uint8' },
      ],
    }],
  },
  {
    type: 'function',
    name: 'getMilestone',
    stateMutability: 'view',
    inputs: [
      { name: 'dealId', type: 'uint256' },
      { name: 'milestoneIndex', type: 'uint8' },
    ],
    outputs: [{
      name: 'milestone',
      type: 'tuple',
      components: [
        { name: 'bps', type: 'uint256' },
        { name: 'condition', type: 'uint8' },
        { name: 'attestor', type: 'address' },
        { name: 'deadline', type: 'uint64' },
        { name: 'gracePeriod', type: 'uint32' },
        { name: 'reviewWindow', type: 'uint32' },
        { name: 'state', type: 'uint8' },
        { name: 'attestorAccepted', type: 'bool' },
        { name: 'attested', type: 'bool' },
        { name: 'evidenceHash', type: 'bytes32' },
        { name: 'disputed', type: 'bool' },
        { name: 'buyerRaisedDispute', type: 'bool' },
        { name: 'reviewWindowStart', type: 'uint64' },
        { name: 'arbiterDeadline', type: 'uint64' },
        { name: 'threshold', type: 'uint8' },
        { name: 'attestCount', type: 'uint8' },
        { name: 'disputeRaiser', type: 'address' },
        { name: 'disputeTime', type: 'uint64' },
        { name: 'disputeEvidenceHash', type: 'bytes32' },
        { name: 'responseDeadline', type: 'uint64' },
        { name: 'responseHash', type: 'bytes32' },
        { name: 'responseSubmitted', type: 'bool' },
      ],
    }],
  },
  ...(['getPendingPayoutChange', 'getPendingRefundChange'] as const).map((name) => ({
    type: 'function' as const,
    name,
    stateMutability: 'view' as const,
    inputs: [{ name: 'dealId', type: 'uint256' }],
    outputs: [
      {
        name: 'change',
        type: 'tuple',
        components: [
          { name: 'proposed', type: 'address' },
          { name: 'eta', type: 'uint64' },
        ],
      },
    ],
  })),
  {
    type: 'function',
    name: 'getAttestors',
    stateMutability: 'view',
    inputs: [
      { name: 'dealId', type: 'uint256' },
      { name: 'milestoneIndex', type: 'uint8' },
    ],
    outputs: [{ name: '', type: 'address[]' }],
  },
  {
    type: 'function',
    name: 'getPanelMembers',
    stateMutability: 'view',
    inputs: [{ name: 'dealId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address[3]' }],
  },
  {
    type: 'function',
    name: 'getPanelVote',
    stateMutability: 'view',
    inputs: [
      { name: 'dealId', type: 'uint256' },
      { name: 'milestoneIndex', type: 'uint8' },
      { name: 'member', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint32' }],
  },
  {
    type: 'function',
    name: 'arbiterFeeBalance',
    stateMutability: 'view',
    inputs: [{ name: 'arbiter', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'feeBalance',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'nextDealId',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'getTrancheFee',
    stateMutability: 'view',
    inputs: [
      { name: 'dealId', type: 'uint256' },
      { name: 'milestoneIndex', type: 'uint8' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'isFullyAccepted',
    stateMutability: 'view',
    inputs: [{ name: 'dealId', type: 'uint256' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'acceptSupplier',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'dealId', type: 'uint256' },
      { name: 'payoutAddress', type: 'address' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'acceptAttestor',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'dealId', type: 'uint256' },
      { name: 'milestoneIndex', type: 'uint8' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'acceptArbiter',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'dealId', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'fund',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'dealId', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'approveMilestone',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'dealId', type: 'uint256' },
      { name: 'milestoneIndex', type: 'uint8' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'claim',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'dealId', type: 'uint256' },
      { name: 'milestoneIndex', type: 'uint8' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'refund',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'dealId', type: 'uint256' },
      { name: 'milestoneIndex', type: 'uint8' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'applyDefault',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'dealId', type: 'uint256' },
      { name: 'milestoneIndex', type: 'uint8' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'dispute',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'dealId', type: 'uint256' },
      { name: 'milestoneIndex', type: 'uint8' },
      { name: 'evidenceHash', type: 'bytes32' },
    ],
    outputs: [],
  },
] as const satisfies Abi

const USDC_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const satisfies Abi

type MilestoneId = { dealId: bigint; milestoneIndex: number }

export type EscrowAction =
  | { kind: 'acceptSupplier'; dealId: bigint; payoutAddress: `0x${string}` }
  | { kind: 'acceptAttestor'; dealId: bigint; milestoneIndex: number }
  | { kind: 'acceptArbiter'; dealId: bigint }
  | { kind: 'fund'; dealId: bigint }
  | { kind: 'approveMilestone' } & MilestoneId
  | { kind: 'claim' } & MilestoneId
  | { kind: 'refund' } & MilestoneId
  | { kind: 'applyDefault' } & MilestoneId
  | { kind: 'dispute'; dealId: bigint; milestoneIndex: number; evidenceHash: Hex }

export type UsdcAction = {
  kind: 'approveEscrow'
  amount: bigint
}

export interface EncodedWalletAction {
  to: `0x${string}`
  data: Hex
  chainId: number
}

function assertMilestoneIndex(index: number): void {
  if (!Number.isInteger(index) || index < 0 || index > 255) {
    throw new Error(`Invalid milestone index: ${index}`)
  }
}

export function encodeEscrowAction(
  action: EscrowAction,
  network: WaybillNetworkManifest = getBrowserNetwork(),
): EncodedWalletAction {
  let functionName: string
  let args: readonly unknown[]

  switch (action.kind) {
    case 'acceptSupplier':
      functionName = 'acceptSupplier'
      args = [action.dealId, action.payoutAddress]
      break
    case 'acceptAttestor':
      assertMilestoneIndex(action.milestoneIndex)
      functionName = 'acceptAttestor'
      args = [action.dealId, action.milestoneIndex]
      break
    case 'acceptArbiter':
      functionName = 'acceptArbiter'
      args = [action.dealId]
      break
    case 'fund':
      functionName = 'fund'
      args = [action.dealId]
      break
    case 'approveMilestone':
    case 'claim':
    case 'refund':
    case 'applyDefault':
      assertMilestoneIndex(action.milestoneIndex)
      functionName = action.kind
      args = [action.dealId, action.milestoneIndex]
      break
    case 'dispute':
      assertMilestoneIndex(action.milestoneIndex)
      functionName = 'dispute'
      args = [action.dealId, action.milestoneIndex, action.evidenceHash]
      break
    default:
      throw new Error('Unsupported escrow action')
  }

  return {
    to: network.contracts.escrow,
    data: encodeFunctionData({
      abi: WAYBILL_ESCROW_ABI,
      functionName: functionName as never,
      args: args as never,
    }),
    chainId: network.chainId,
  }
}

export function encodeUsdcApproval(
  amount: bigint,
  network: WaybillNetworkManifest = getBrowserNetwork(),
): EncodedWalletAction {
  if (amount < 0n) throw new Error('USDC approval amount cannot be negative')
  return {
    to: network.usdc.address,
    data: encodeFunctionData({
      abi: USDC_ABI,
      functionName: 'approve',
      args: [network.contracts.escrow, amount],
    }),
    chainId: network.chainId,
  }
}

export async function sendWalletAction(
  walletClient: WalletClient,
  action: EncodedWalletAction,
): Promise<`0x${string}`> {
  if (walletClient.chain?.id !== action.chainId) {
    throw new Error(`Wallet is on chain ${walletClient.chain?.id ?? 'unknown'}, expected ${action.chainId}`)
  }
  if (!walletClient.account) throw new Error('No active wallet account')
  return walletClient.sendTransaction({
    account: walletClient.account,
    chain: null,
    to: action.to,
    data: action.data,
  })
}

export function readDeal(
  publicClient: PublicClient,
  dealId: bigint,
  network: WaybillNetworkManifest = getBrowserNetwork(),
) {
  return publicClient.readContract({
    address: network.contracts.escrow,
    abi: WAYBILL_ESCROW_ABI,
    functionName: 'getDeal',
    args: [dealId],
  })
}

export function readMilestone(
  publicClient: PublicClient,
  dealId: bigint,
  milestoneIndex: number,
  network: WaybillNetworkManifest = getBrowserNetwork(),
) {
  assertMilestoneIndex(milestoneIndex)
  return publicClient.readContract({
    address: network.contracts.escrow,
    abi: WAYBILL_ESCROW_ABI,
    functionName: 'getMilestone',
    args: [dealId, milestoneIndex],
  })
}

/** The three panel members of a deal, or null for a single-arbiter deal (the escrow returns three zero addresses). */
export async function readPanelMembers(
  publicClient: PublicClient,
  dealId: bigint,
  network: WaybillNetworkManifest = getBrowserNetwork(),
): Promise<readonly `0x${string}`[] | null> {
  const members = (await publicClient.readContract({
    address: network.contracts.escrow,
    abi: WAYBILL_ESCROW_ABI,
    functionName: 'getPanelMembers',
    args: [dealId],
  })) as readonly `0x${string}`[]
  return members.every((m) => m.toLowerCase() === '0x0000000000000000000000000000000000000000') ? null : members
}

/** The encoded vote one panel member cast on one part; 0 means none yet. */
export function readPanelVote(
  publicClient: PublicClient,
  dealId: bigint,
  milestoneIndex: number,
  member: `0x${string}`,
  network: WaybillNetworkManifest = getBrowserNetwork(),
) {
  assertMilestoneIndex(milestoneIndex)
  return publicClient.readContract({
    address: network.contracts.escrow,
    abi: WAYBILL_ESCROW_ABI,
    functionName: 'getPanelVote',
    args: [dealId, milestoneIndex, member],
  }) as Promise<number>
}

/** The wallets named to confirm one part. */
export function readPartAttestors(
  publicClient: PublicClient,
  dealId: bigint,
  milestoneIndex: number,
  network: WaybillNetworkManifest = getBrowserNetwork(),
) {
  assertMilestoneIndex(milestoneIndex)
  return publicClient.readContract({
    address: network.contracts.escrow,
    abi: WAYBILL_ESCROW_ABI,
    functionName: 'getAttestors',
    args: [dealId, milestoneIndex],
  }) as Promise<readonly `0x${string}`[]>
}

/** Fees an account has earned and not yet withdrawn, raw 6-decimal USDC units. */
export function readFeeBalance(
  publicClient: PublicClient,
  account: `0x${string}`,
  network: WaybillNetworkManifest = getBrowserNetwork(),
) {
  return publicClient.readContract({
    address: network.contracts.escrow,
    abi: WAYBILL_ESCROW_ABI,
    functionName: 'feeBalance',
    args: [account],
  }) as Promise<bigint>
}

/** What an arbiter has earned across deals and not yet withdrawn, raw 6-decimal USDC units. */
export function readArbiterFeeBalance(
  publicClient: PublicClient,
  arbiter: `0x${string}`,
  network: WaybillNetworkManifest = getBrowserNetwork(),
) {
  return publicClient.readContract({
    address: network.contracts.escrow,
    abi: WAYBILL_ESCROW_ABI,
    functionName: 'arbiterFeeBalance',
    args: [arbiter],
  }) as Promise<bigint>
}

/** A delayed payout or refund address change that is waiting, if any. */
export async function readPendingChange(
  publicClient: PublicClient,
  dealId: bigint,
  which: 'payout' | 'refund',
  network: WaybillNetworkManifest = getBrowserNetwork(),
): Promise<{ proposed: `0x${string}`; eta: bigint }> {
  const change = (await publicClient.readContract({
    address: network.contracts.escrow,
    abi: WAYBILL_ESCROW_ABI,
    functionName: which === 'payout' ? 'getPendingPayoutChange' : 'getPendingRefundChange',
    args: [dealId],
  })) as unknown as { proposed: `0x${string}`; eta: bigint }
  return { proposed: change.proposed, eta: change.eta }
}

export function readNextDealId(
  publicClient: PublicClient,
  network: WaybillNetworkManifest = getBrowserNetwork(),
) {
  return publicClient.readContract({
    address: network.contracts.escrow,
    abi: WAYBILL_ESCROW_ABI,
    functionName: 'nextDealId',
  })
}

export function readTrancheFee(
  publicClient: PublicClient,
  dealId: bigint,
  milestoneIndex: number,
  network: WaybillNetworkManifest = getBrowserNetwork(),
) {
  assertMilestoneIndex(milestoneIndex)
  return publicClient.readContract({
    address: network.contracts.escrow,
    abi: WAYBILL_ESCROW_ABI,
    functionName: 'getTrancheFee',
    args: [dealId, milestoneIndex],
  })
}

export function readUsdcBalance(
  publicClient: PublicClient,
  account: `0x${string}`,
  network: WaybillNetworkManifest = getBrowserNetwork(),
) {
  return publicClient.readContract({
    address: network.usdc.address,
    abi: USDC_ABI,
    functionName: 'balanceOf',
    args: [account],
  })
}

export function readUsdcAllowance(
  publicClient: PublicClient,
  owner: `0x${string}`,
  network: WaybillNetworkManifest = getBrowserNetwork(),
  spender?: `0x${string}`,
) {
  const allowanceSpender = spender ?? network.contracts.escrow
  return publicClient.readContract({
    address: network.usdc.address,
    abi: USDC_ABI,
    functionName: 'allowance',
    args: [owner, allowanceSpender],
  })
}
