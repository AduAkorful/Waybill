import { describe, expect, test } from 'bun:test'
import { buildDeal, emptyForm, TEMPLATES, type BuilderLimits } from './builder'
import { contractHoursToDays, graceEnds, overdueStatus, reviewEnds, reviewSeconds } from './derive'
import type { Tranche } from './types'

// The escrow multiplies gracePeriod and reviewWindow by `1 hours` (DisputeLogic._graceEnd, AttestLogic, ClaimLogic.unlockTs).
const buyer = '0x00000000000000000000000000000000000000b1'
const supplier = '0x00000000000000000000000000000000000000c2'
const arbiter = '0x00000000000000000000000000000000000000d3'
const attestor = '0x00000000000000000000000000000000000000e4'
const limits: BuilderLimits = { minFeeBps: 50, maxFeeBps: 100, maxDealAmount: 10_000_000_000n, maxLocked: 50_000_000_000n, currentLocked: 0n, newDealsPaused: false }
const NOW = 1_800_000_000

function built(graceDays: string, reviewHours: string) {
  const f = emptyForm(buyer, 75, TEMPLATES[2]!)
  f.supplier = supplier
  f.arbiter = arbiter
  f.total = '1000'
  f.parts[1]!.attestors = [attestor]
  for (const p of f.parts) { p.graceDays = graceDays; p.reviewHours = reviewHours }
  const r = buildDeal(f, buyer, limits, { allowed: true, fee: 0n }, NOW)
  if (!r.ok) throw new Error(r.errors.join('; '))
  return r.deal.milestoneInputs[0]!
}

const tranche = (over: Partial<Tranche>) => ({ state: 'waiting', condition: 'buyer_approval', deadline: 1_000_000n, gracePeriod: 24, reviewWindow: 24, reviewWindowStart: 0n, ...over }) as Tranche

describe('window units match the contract (hours)', () => {
  test('the builder writes hours, not seconds', () => {
    const m = built('7', '24')
    expect(m.gracePeriod).toBe(168)
    expect(m.reviewWindow).toBe(24)
  })
  for (const days of [0, 1, 2, 7, 30, 365]) {
    test(`round trip: ${days} grace days → contract → ${days} days shown`, () => {
      const m = built(String(days), '48')
      expect(contractHoursToDays(m.gracePeriod)).toBe(days)
      expect(graceEnds(tranche({ deadline: 0n, gracePeriod: m.gracePeriod }))).toBe(BigInt(days * 86_400))
    })
  }
  test('round trip: review hours → contract → same review length', () => {
    const m = built('7', '48')
    expect(reviewSeconds(m)).toBe(48n * 3600n)
    expect(reviewEnds(tranche({ state: 'in_review', reviewWindow: m.reviewWindow, reviewWindowStart: 100n }))).toBe(100n + 48n * 3600n)
  })
})

describe('client-side overdue', () => {
  const t = tranche({ deadline: 1_000n, gracePeriod: 1 })
  test('before the deadline nothing is late', () => expect(overdueStatus(t, 1_000n)).toBeNull())
  test('past the deadline within grace it is overdue even though the chain still says WAITING', () => {
    expect(overdueStatus(t, 1_001n)).toBe('overdue')
    expect(overdueStatus(t, 1_000n + 3_600n)).toBe('overdue')
  })
  test('after grace it is a default the buyer can take back', () => expect(overdueStatus(t, 1_000n + 3_601n)).toBe('default'))
  test('timed parts are never overdue', () => expect(overdueStatus({ ...t, condition: 'timed' }, 9_999_999n)).toBeNull())
  test('a part on-chain OVERDUE follows the same grace', () => expect(overdueStatus({ ...t, state: 'overdue' }, 99_999n)).toBe('default'))
  test('in review or claimable is not overdue', () => expect(overdueStatus({ ...t, state: 'in_review' }, 99_999n)).toBeNull())
})
