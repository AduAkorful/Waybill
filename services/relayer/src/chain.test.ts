import { describe, expect, test } from 'bun:test'

import { ARC_TESTNET } from '@waybill/network/networks'
import {
  candidateFromSignal,
  createRelayerChain,
  RELAYER_SIGNAL_EVENTS,
} from './chain'

describe('relayer chain boundary', () => {
  test('creates a read-only client from the shared manifest', () => {
    const chain = createRelayerChain(ARC_TESTNET)

    expect(chain.client.chain?.id).toBe(5_042_002)
    expect(chain.escrow).toBe(ARC_TESTNET.contracts.escrow)
  })

  test('declares only the signals used to wake the relayer', () => {
    expect(RELAYER_SIGNAL_EVENTS.map((e) => e.name)).toEqual(['MilestoneClaimable', 'PayoutFailed', 'MilestoneRefundable', 'RefundFailed', 'DisputeRaised', 'DisputeWithdrawn'])
  })

  test('maps claim, refund, and default signals to recheck candidates', () => {
    expect(candidateFromSignal('MilestoneClaimable', { dealId: 7n, milestoneIndex: 2 })).toEqual({
      operation: 'claim',
      dealId: 7n,
      milestoneIndex: 2,
      sourceEvent: 'MilestoneClaimable',
      requiresEligibilityRecheck: true,
    })
    expect(candidateFromSignal('RefundFailed', { dealId: '8', milestoneIndex: 1 })).toMatchObject({
      operation: 'refund',
      dealId: 8n,
      milestoneIndex: 1,
    })
    expect(candidateFromSignal('DisputeRaised', { dealId: 9, milestoneIndex: 0 })).toMatchObject({
      operation: 'applyDefault',
      dealId: 9n,
      milestoneIndex: 0,
    })
    // a withdrawn dispute leaves the part claimable with no MilestoneClaimable event (found on the fork run)
    expect(candidateFromSignal('DisputeWithdrawn', { dealId: 10, milestoneIndex: 1 })).toMatchObject({
      operation: 'claim',
      dealId: 10n,
      milestoneIndex: 1,
    })
  })

  test('ignores unrelated events and rejects malformed known events', () => {
    expect(candidateFromSignal('DealCreated', { dealId: 1, milestoneIndex: 0 })).toBeNull()
    expect(() => candidateFromSignal('MilestoneClaimable', undefined)).toThrow('Missing arguments')
    expect(() =>
      candidateFromSignal('MilestoneClaimable', { dealId: 1, milestoneIndex: 256 }),
    ).toThrow('Invalid milestoneIndex')
  })
})
