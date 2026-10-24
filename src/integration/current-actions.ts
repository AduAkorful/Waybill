import {
  encodeFunctionData,
  type Abi,
  type Hex,
} from 'viem'
import type { Address, WaybillNetworkManifest } from '../../config/networks'
import { getBrowserNetwork } from './network'
import type { EncodedWalletAction } from './escrow'

const MILESTONE_INPUT_COMPONENTS = [
  { name: 'bps', type: 'uint256' },
  { name: 'condition', type: 'uint8' },
  { name: 'attestors', type: 'address[]' },
  { name: 'threshold', type: 'uint8' },
  { name: 'deadline', type: 'uint64' },
  { name: 'gracePeriod', type: 'uint32' },
  { name: 'reviewWindow', type: 'uint32' },
  { name: 'dependsOn', type: 'uint16' },
] as const

export const CURRENT_ESCROW_ACTION_ABI = ([
  {
    type: 'function',
    name: 'createDeal',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'supplier', type: 'address' },
      { name: 'buyerRefund', type: 'address' },
      { name: 'arbiter', type: 'address' },
      { name: 'totalAmount', type: 'uint256' },
      { name: 'feeBps', type: 'uint16' },
      { name: 'acceptanceDeadlineTs', type: 'uint64' },
      { name: 'arbiterDeadlineHours', type: 'uint32' },
      { name: 'milestoneInputs', type: 'tuple[]', components: MILESTONE_INPUT_COMPONENTS },
      { name: 'fundFirst', type: 'bool' },
      { name: 'arbiterFee', type: 'uint256' },
      { name: 'feePayer', type: 'uint8' },
    ],
    outputs: [{ name: 'dealId', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'createDealWithPanel',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'supplier', type: 'address' },
      { name: 'buyerRefund', type: 'address' },
      { name: 'arbiter', type: 'address' },
      { name: 'panel', type: 'address[]' },
      { name: 'totalAmount', type: 'uint256' },
      { name: 'feeBps', type: 'uint16' },
      { name: 'acceptanceDeadlineTs', type: 'uint64' },
      { name: 'arbiterDeadlineHours', type: 'uint32' },
      { name: 'milestoneInputs', type: 'tuple[]', components: MILESTONE_INPUT_COMPONENTS },
      { name: 'fundFirst', type: 'bool' },
      { name: 'arbiterFee', type: 'uint256' },
      { name: 'feePayer', type: 'uint8' },
    ],
    outputs: [{ name: 'dealId', type: 'uint256' }],
  },
  ...[
    ['cancelUnaccepted', [{ name: 'dealId', type: 'uint256' }]],
    ['withdrawDispute', [
      { name: 'dealId', type: 'uint256' },
      { name: 'milestoneIndex', type: 'uint8' },
    ]],
    ['retryArbiterFeeRefund', [{ name: 'dealId', type: 'uint256' }]],
    ['withdrawArbiterFee', [{ name: 'dealId', type: 'uint256' }]],
    ['rejectPayoutChange', [{ name: 'dealId', type: 'uint256' }]],
    ['applyPayoutChange', [{ name: 'dealId', type: 'uint256' }]],
    ['rejectRefundChange', [{ name: 'dealId', type: 'uint256' }]],
    ['applyRefundChange', [{ name: 'dealId', type: 'uint256' }]],
  ].map(([name, inputs]) => ({
    type: 'function',
    name,
    stateMutability: 'nonpayable',
    inputs,
    outputs: [],
  })),
  {
    type: 'function',
    name: 'attest',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'dealId', type: 'uint256' },
      { name: 'milestoneIndex', type: 'uint8' },
      { name: 'evidenceHash', type: 'bytes32' },
      { name: 'signedAt', type: 'uint64' },
      { name: 'expiry', type: 'uint64' },
      { name: 'signer', type: 'address' },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'respondToDispute',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'dealId', type: 'uint256' },
      { name: 'milestoneIndex', type: 'uint8' },
      { name: 'evidenceHash', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'appendDisputeEvidence',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'dealId', type: 'uint256' },
      { name: 'milestoneIndex', type: 'uint8' },
      { name: 'evidenceHash', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'resolve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'dealId', type: 'uint256' },
      { name: 'milestoneIndex', type: 'uint8' },
      { name: 'toSupplier', type: 'bool' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'resolveSplit',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'dealId', type: 'uint256' },
      { name: 'milestoneIndex', type: 'uint8' },
      { name: 'supplierBps', type: 'uint16' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'castPanelVote',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'dealId', type: 'uint256' },
      { name: 'milestoneIndex', type: 'uint8' },
      { name: 'vote', type: 'uint32' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'retryCascadeRefund',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'dealId', type: 'uint256' },
      { name: 'milestoneIndex', type: 'uint8' },
    ],
    outputs: [],
  },
  ...[
    ['proposePayout', [
      { name: 'dealId', type: 'uint256' },
      { name: 'newAddr', type: 'address' },
    ]],
    ['proposeRefundAddress', [
      { name: 'dealId', type: 'uint256' },
      { name: 'newAddr', type: 'address' },
    ]],
  ].map(([name, inputs]) => ({
    type: 'function',
    name,
    stateMutability: 'nonpayable',
    inputs,
    outputs: [],
  })),
] as unknown) as Abi

export type FeePayer = 0 | 1 | 2
export type ReleaseCondition = 0 | 1 | 2 | 3

export interface MilestoneInput {
  bps: bigint
  condition: ReleaseCondition
  attestors: Address[]
  threshold: number
  deadline: bigint
  gracePeriod: number
  reviewWindow: number
  dependsOn: number
}

interface CreateDealFields {
  supplier: Address
  buyerRefund: Address
  arbiter: Address
  totalAmount: bigint
  feeBps: number
  acceptanceDeadlineTs: bigint
  arbiterDeadlineHours: number
  milestoneInputs: MilestoneInput[]
  fundFirst: boolean
  arbiterFee: bigint
  feePayer: FeePayer
}

type MilestoneAction = { dealId: bigint; milestoneIndex: number }

export type CurrentEscrowAction =
  | ({ kind: 'createDeal' } & CreateDealFields)
  | ({ kind: 'createDealWithPanel'; panel: Address[] } & CreateDealFields)
  | { kind: 'cancelUnaccepted'; dealId: bigint }
  | { kind: 'attest'; dealId: bigint; milestoneIndex: number; evidenceHash: Hex; signedAt: bigint; expiry: bigint; signer: Address; signature: Hex }
  | { kind: 'respondToDispute'; evidenceHash: Hex } & MilestoneAction
  | { kind: 'appendDisputeEvidence'; evidenceHash: Hex } & MilestoneAction
  | { kind: 'withdrawDispute' } & MilestoneAction
  | { kind: 'resolve'; toSupplier: boolean } & MilestoneAction
  | { kind: 'resolveSplit'; supplierBps: number } & MilestoneAction
  | { kind: 'castPanelVote'; vote: number } & MilestoneAction
  | { kind: 'retryCascadeRefund' } & MilestoneAction
  | { kind: 'retryArbiterFeeRefund'; dealId: bigint }
  | { kind: 'withdrawArbiterFee'; dealId: bigint }
  | { kind: 'proposePayout'; dealId: bigint; newAddr: Address }
  | { kind: 'rejectPayoutChange'; dealId: bigint }
  | { kind: 'applyPayoutChange'; dealId: bigint }
  | { kind: 'proposeRefundAddress'; dealId: bigint; newAddr: Address }
  | { kind: 'rejectRefundChange'; dealId: bigint }
  | { kind: 'applyRefundChange'; dealId: bigint }

function assertUint(value: bigint | number, max: bigint, field: string): void {
  const numeric = typeof value === 'number' ? BigInt(value) : value
  if (numeric < 0n || numeric > max) throw new Error(`${field} is outside its uint range`)
}

function assertAddress(value: string, field: string): asserts value is Address {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) throw new Error(`Invalid ${field}`)
}

function assertHash(value: string, field: string): asserts value is Hex {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error(`Invalid ${field}`)
}

function validateCreate(fields: CreateDealFields, panel?: Address[]): void {
  assertAddress(fields.supplier, 'supplier')
  assertAddress(fields.buyerRefund, 'buyerRefund')
  assertAddress(fields.arbiter, 'arbiter')
  assertUint(fields.totalAmount, 2n ** 256n - 1n, 'totalAmount')
  assertUint(fields.feeBps, 65_535n, 'feeBps')
  assertUint(fields.acceptanceDeadlineTs, 2n ** 64n - 1n, 'acceptanceDeadlineTs')
  assertUint(fields.arbiterDeadlineHours, 2n ** 32n - 1n, 'arbiterDeadlineHours')
  assertUint(fields.arbiterFee, 2n ** 256n - 1n, 'arbiterFee')
  if (![0, 1, 2].includes(fields.feePayer)) throw new Error('Invalid feePayer')
  if (panel && panel.length !== 0 && panel.length !== 3) {
    throw new Error('Panel must be empty or contain exactly 3 arbiters')
  }
  if (panel) {
    const normalized = panel.map((member) => {
      assertAddress(member, 'panel member')
      return member.toLowerCase()
    })
    if (new Set(normalized).size !== normalized.length) {
      throw new Error('Panel members must be distinct')
    }
  }
  if (fields.milestoneInputs.length === 0 || fields.milestoneInputs.length > 8) {
    throw new Error('Milestone count must be between 1 and 8')
  }
  let totalBps = 0n
  for (const [index, milestone] of fields.milestoneInputs.entries()) {
    assertUint(milestone.bps, 2n ** 256n - 1n, `milestone[${index}].bps`)
    totalBps += milestone.bps
    if (![0, 1, 2, 3].includes(milestone.condition)) {
      throw new Error(`Invalid milestone[${index}].condition`)
    }
    if (milestone.attestors.length > 5) {
      throw new Error(`Too many attestors in milestone[${index}]`)
    }
    if (milestone.condition === 1) {
      if (milestone.attestors.length === 0) {
        throw new Error(`Attestation milestone[${index}] needs an attestor`)
      }
      if (milestone.threshold < 1 || milestone.threshold > milestone.attestors.length) {
        throw new Error(`Invalid threshold in milestone[${index}]`)
      }
    } else if (milestone.attestors.length !== 0 || milestone.threshold !== 0) {
      throw new Error(`Non-attestation milestone[${index}] cannot have attestors`)
    }
    assertUint(milestone.threshold, 255n, `milestone[${index}].threshold`)
    assertUint(milestone.deadline, 2n ** 64n - 1n, `milestone[${index}].deadline`)
    assertUint(milestone.gracePeriod, 2n ** 32n - 1n, `milestone[${index}].gracePeriod`)
    assertUint(milestone.reviewWindow, 2n ** 32n - 1n, `milestone[${index}].reviewWindow`)
    assertUint(milestone.dependsOn, 65_535n, `milestone[${index}].dependsOn`)
    if (milestone.dependsOn !== 65_535 && milestone.dependsOn >= index) {
      throw new Error(`Milestone[${index}] dependency must be earlier`)
    }
    for (const attestor of milestone.attestors) assertAddress(attestor, 'attestor')
  }
  if (totalBps !== 10_000n) throw new Error('Milestone bps must total 10000')
}

function assertMilestoneAction(action: MilestoneAction): void {
  assertUint(action.dealId, 2n ** 256n - 1n, 'dealId')
  assertUint(action.milestoneIndex, 255n, 'milestoneIndex')
}

function encode(
  functionName: string,
  args: readonly unknown[],
  network: WaybillNetworkManifest,
): EncodedWalletAction {
  return {
    to: network.contracts.escrow,
    data: encodeFunctionData({
      abi: CURRENT_ESCROW_ACTION_ABI,
      functionName: functionName as never,
      args: args as never,
    }),
    chainId: network.chainId,
  }
}

export function encodeCurrentEscrowAction(
  action: CurrentEscrowAction,
  network: WaybillNetworkManifest = getBrowserNetwork(),
): EncodedWalletAction {
  switch (action.kind) {
    case 'createDeal':
    case 'createDealWithPanel': {
      validateCreate(
        action,
        action.kind === 'createDealWithPanel' ? action.panel : undefined,
      )
      const base = [
        action.supplier,
        action.buyerRefund,
        action.arbiter,
        action.totalAmount,
        action.feeBps,
        action.acceptanceDeadlineTs,
        action.arbiterDeadlineHours,
        action.milestoneInputs,
        action.fundFirst,
        action.arbiterFee,
        action.feePayer,
      ]
      return action.kind === 'createDeal'
        ? encode('createDeal', base, network)
        : encode('createDealWithPanel', [
            action.supplier,
            action.buyerRefund,
            action.arbiter,
            action.panel,
            ...base.slice(3),
          ], network)
    }
    case 'cancelUnaccepted':
      assertUint(action.dealId, 2n ** 256n - 1n, 'dealId')
      return encode('cancelUnaccepted', [action.dealId], network)
    case 'attest':
      assertMilestoneAction(action)
      assertHash(action.evidenceHash, 'evidenceHash')
      assertAddress(action.signer, 'signer')
      assertUint(action.signedAt, 2n ** 64n - 1n, 'signedAt')
      assertUint(action.expiry, 2n ** 64n - 1n, 'expiry')
      return encode('attest', [
        action.dealId,
        action.milestoneIndex,
        action.evidenceHash,
        action.signedAt,
        action.expiry,
        action.signer,
        action.signature,
      ], network)
    case 'respondToDispute':
    case 'appendDisputeEvidence':
      assertMilestoneAction(action)
      assertHash(action.evidenceHash, 'evidenceHash')
      return encode(action.kind, [
        action.dealId,
        action.milestoneIndex,
        action.evidenceHash,
      ], network)
    case 'withdrawDispute':
      assertMilestoneAction(action)
      return encode('withdrawDispute', [action.dealId, action.milestoneIndex], network)
    case 'resolve':
      assertMilestoneAction(action)
      return encode('resolve', [action.dealId, action.milestoneIndex, action.toSupplier], network)
    case 'resolveSplit':
      assertMilestoneAction(action)
      assertUint(action.supplierBps, 10_000n, 'supplierBps')
      return encode('resolveSplit', [
        action.dealId,
        action.milestoneIndex,
        action.supplierBps,
      ], network)
    case 'castPanelVote':
      assertMilestoneAction(action)
      assertUint(action.vote, 10_002n, 'vote')
      if (action.vote === 0 || action.vote === 3) throw new Error('Invalid panel vote encoding')
      return encode('castPanelVote', [
        action.dealId,
        action.milestoneIndex,
        action.vote,
      ], network)
    case 'retryCascadeRefund':
      assertMilestoneAction(action)
      return encode('retryCascadeRefund', [action.dealId, action.milestoneIndex], network)
    case 'retryArbiterFeeRefund':
    case 'withdrawArbiterFee':
    case 'rejectPayoutChange':
    case 'applyPayoutChange':
    case 'rejectRefundChange':
    case 'applyRefundChange':
      assertUint(action.dealId, 2n ** 256n - 1n, 'dealId')
      return encode(action.kind, [action.dealId], network)
    case 'proposePayout':
    case 'proposeRefundAddress':
      assertUint(action.dealId, 2n ** 256n - 1n, 'dealId')
      assertAddress(action.newAddr, 'newAddr')
      return encode(action.kind, [action.dealId, action.newAddr], network)
    default:
      throw new Error('Unsupported current escrow action')
  }
}
