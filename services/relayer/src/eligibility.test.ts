import { describe, expect, test } from 'bun:test'

import type { RelayerCandidate } from './chain'
import {
  checkCandidateEligibility,
  MemoryCursorStore,
  MILESTONE_STATES,
} from './eligibility'

const candidate = (operation: RelayerCandidate['operation']): RelayerCandidate => ({
  operation,
  dealId: 1n,
  milestoneIndex: 0,
  sourceEvent: 'test',
  requiresEligibilityRecheck: true,
})

describe('relayer eligibility', () => {
  test('allows claim only after a fresh CLAIMABLE read', () => {
    expect(checkCandidateEligibility(candidate('claim'), {
      state: MILESTONE_STATES.CLAIMABLE,
      deadline: 100n,
      gracePeriod: 24,
      disputed: false,
      responseDeadline: 0n,
      arbiterDeadline: 0n,
    }, 100n)).toEqual({ eligible: true })
    expect(checkCandidateEligibility(candidate('claim'), {
      state: MILESTONE_STATES.WAITING,
      deadline: 100n,
      gracePeriod: 24,
      disputed: false,
      responseDeadline: 0n,
      arbiterDeadline: 0n,
    }, 100n).eligible).toBe(false)
  })

  test('allows refund only from REFUNDABLE', () => {
    expect(checkCandidateEligibility(candidate('refund'), {
      state: MILESTONE_STATES.REFUNDABLE,
      deadline: 0n,
      gracePeriod: 0,
      disputed: false,
      responseDeadline: 0n,
      arbiterDeadline: 0n,
    }, 0n)).toEqual({ eligible: true })
    expect(checkCandidateEligibility(candidate('refund'), {
      state: MILESTONE_STATES.OVERDUE,
      deadline: 0n,
      gracePeriod: 0,
      disputed: false,
      responseDeadline: 0n,
      arbiterDeadline: 0n,
    }, 1n).eligible).toBe(false)
  })

  test('uses strict deadline boundaries for default', () => {
    const disputed = {
      state: MILESTONE_STATES.DISPUTED,
      deadline: 0n,
      gracePeriod: 0,
      disputed: true,
      responseDeadline: 10n,
      arbiterDeadline: 20n,
    }
    expect(checkCandidateEligibility(candidate('applyDefault'), disputed, 20n).eligible).toBe(false)
    expect(checkCandidateEligibility(candidate('applyDefault'), disputed, 21n)).toEqual({ eligible: true })

    // After an early response the escrow resets arbiterDeadline from the response time; the
    // relayer must use that fresh on-chain value, not responseDeadline + arbiterDeadlineHours.
    const respondedEarly = { ...disputed, responseDeadline: 100n, arbiterDeadline: 50n }
    expect(checkCandidateEligibility(candidate('applyDefault'), respondedEarly, 50n).eligible).toBe(false)
    expect(checkCandidateEligibility(candidate('applyDefault'), respondedEarly, 51n)).toEqual({ eligible: true })

    const overdue = {
      state: MILESTONE_STATES.OVERDUE,
      deadline: 100n,
      gracePeriod: 2,
      disputed: false,
      responseDeadline: 0n,
      arbiterDeadline: 0n,
    }
    expect(checkCandidateEligibility(candidate('applyDefault'), overdue, 7_300n).eligible).toBe(false)
    expect(checkCandidateEligibility(candidate('applyDefault'), overdue, 7_301n)).toEqual({ eligible: true })
  })
})

describe('MemoryCursorStore', () => {
  test('is idempotent and monotonic', async () => {
    const store = new MemoryCursorStore()
    await store.set({ blockNumber: 10n, logIndex: 2n })
    await store.set({ blockNumber: 10n, logIndex: 2n })
    await store.set({ blockNumber: 11n, logIndex: 0n })
    expect(await store.get()).toEqual({ blockNumber: 11n, logIndex: 0n })
    await expect(store.set({ blockNumber: 10n, logIndex: 9n })).rejects.toThrow('cannot move backwards')
  })
})
