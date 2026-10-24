import { describe, expect, test } from 'bun:test'
import { balanceReadiness, cancelReadiness, fundReadiness } from './readiness'
import type { DealView } from './types'

const deal = (over: Partial<DealView>) => ({ state: 'proposed', chainTime: 100n, acceptanceDeadline: 200n, ...over }) as DealView

describe('readiness', () => {
  test('fund waits for every acceptance and names who is missing', () => {
    expect(fundReadiness(deal({}), ['attestor · stub 0 (0xab…cd)'])).toEqual({ ok: false, reason: 'Waiting for attestor · stub 0 (0xab…cd) to accept.' })
    expect(fundReadiness(deal({ state: 'accepted' }), [])).toEqual({ ok: true })
  })
  test('fund is closed after the acceptance deadline', () => {
    expect(fundReadiness(deal({ chainTime: 300n }), []).ok).toBe(false)
  })
  test('cancel only after the acceptance deadline', () => {
    expect(cancelReadiness(deal({})).ok).toBe(false)
    expect(cancelReadiness(deal({ chainTime: 201n })).ok).toBe(true)
    expect(cancelReadiness(deal({ state: 'funded' })).ok).toBe(false)
  })
  test('balance must cover the lock', () => {
    const f = (v: bigint) => String(v)
    expect(balanceReadiness(5n, 10n, f).ok).toBe(false)
    expect(balanceReadiness(10n, 10n, f).ok).toBe(true)
  })
})
