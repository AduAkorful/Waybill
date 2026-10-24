import { describe, expect, test } from 'bun:test'
import { decodeFunctionData } from 'viem'
import { ARC_TESTNET } from '@waybill/network/networks'
import {
  CURRENT_ESCROW_ACTION_ABI,
  encodeCurrentEscrowAction,
  type MilestoneInput,
} from './current-actions'

const supplier = '0x1111111111111111111111111111111111111111' as const
const buyerRefund = '0x2222222222222222222222222222222222222222' as const
const arbiter = '0x3333333333333333333333333333333333333333' as const
const attestor = '0x4444444444444444444444444444444444444444' as const
const evidenceHash =
  '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const

const milestone: MilestoneInput = {
  bps: 10_000n,
  condition: 1,
  attestors: [attestor],
  threshold: 1,
  deadline: 2_000_000_000n,
  gracePeriod: 86_400,
  reviewWindow: 86_400,
  dependsOn: 65_535,
}

describe('complete current escrow action boundary', () => {
  test('encodes the full fee-payer create-deal path', () => {
    const encoded = encodeCurrentEscrowAction(
      {
        kind: 'createDeal',
        supplier,
        buyerRefund,
        arbiter,
        totalAmount: 1_000_000n,
        feeBps: 100,
        acceptanceDeadlineTs: 2_000_000_000n,
        arbiterDeadlineHours: 168,
        milestoneInputs: [milestone],
        fundFirst: false,
        arbiterFee: 10_000n,
        feePayer: 2,
      },
      ARC_TESTNET,
    )
    const decoded = decodeFunctionData({ abi: CURRENT_ESCROW_ACTION_ABI, data: encoded.data })
    expect(encoded.to).toBe(ARC_TESTNET.contracts.escrow)
    expect(decoded.functionName).toBe('createDeal')
    expect(decoded.args?.[9]).toBe(10_000n)
    expect(decoded.args?.[10]).toBe(2)
  })

  test('encodes signer-bound attestations and panel resolutions', () => {
    const attest = encodeCurrentEscrowAction(
      {
        kind: 'attest',
        dealId: 7n,
        milestoneIndex: 0,
        evidenceHash,
        signedAt: 1_900_000_000n,
        expiry: 2_000_000_000n,
        signer: attestor,
        signature: '0xbb',
      },
      ARC_TESTNET,
    )
    const vote = encodeCurrentEscrowAction(
      { kind: 'castPanelVote', dealId: 7n, milestoneIndex: 0, vote: 5 },
      ARC_TESTNET,
    )
    expect(decodeFunctionData({ abi: CURRENT_ESCROW_ACTION_ABI, data: attest.data }).functionName).toBe(
      'attest',
    )
    expect(decodeFunctionData({ abi: CURRENT_ESCROW_ACTION_ABI, data: vote.data }).functionName).toBe(
      'castPanelVote',
    )
  })

  test('encodes delayed payout changes and dispute resolution', () => {
    const payout = encodeCurrentEscrowAction(
      {
        kind: 'proposePayout',
        dealId: 7n,
        newAddr: supplier,
      },
      ARC_TESTNET,
    )
    const split = encodeCurrentEscrowAction(
      {
        kind: 'resolveSplit',
        dealId: 7n,
        milestoneIndex: 0,
        supplierBps: 6_000,
      },
      ARC_TESTNET,
    )
    expect(decodeFunctionData({ abi: CURRENT_ESCROW_ACTION_ABI, data: payout.data }).functionName).toBe(
      'proposePayout',
    )
    expect(decodeFunctionData({ abi: CURRENT_ESCROW_ACTION_ABI, data: split.data }).functionName).toBe(
      'resolveSplit',
    )
  })

  test('rejects invalid hashes, panel votes, and create inputs', () => {
    expect(() =>
      encodeCurrentEscrowAction(
        {
          kind: 'respondToDispute',
          dealId: 1n,
          milestoneIndex: 0,
          evidenceHash: '0x12',
        },
        ARC_TESTNET,
      ),
    ).toThrow('Invalid evidenceHash')
    expect(() =>
      encodeCurrentEscrowAction(
        { kind: 'castPanelVote', dealId: 1n, milestoneIndex: 0, vote: 3 },
        ARC_TESTNET,
      ),
    ).toThrow('Invalid panel vote')
    expect(() =>
      encodeCurrentEscrowAction(
        {
          kind: 'createDeal',
          supplier,
          buyerRefund,
          arbiter,
          totalAmount: 1n,
          feeBps: 100,
          acceptanceDeadlineTs: 2_000_000_000n,
          arbiterDeadlineHours: 1,
          milestoneInputs: [],
          fundFirst: false,
          arbiterFee: 0n,
          feePayer: 0,
        },
        ARC_TESTNET,
      ),
    ).toThrow('Milestone count')
    expect(() =>
      encodeCurrentEscrowAction(
        {
          kind: 'createDealWithPanel',
          supplier,
          buyerRefund,
          arbiter,
          panel: [attestor, attestor, arbiter],
          totalAmount: 1n,
          feeBps: 100,
          acceptanceDeadlineTs: 2_000_000_000n,
          arbiterDeadlineHours: 1,
          milestoneInputs: [milestone],
          fundFirst: false,
          arbiterFee: 0n,
          feePayer: 0,
        },
        ARC_TESTNET,
      ),
    ).toThrow('distinct')
  })
})
