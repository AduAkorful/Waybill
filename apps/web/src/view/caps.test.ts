import { describe, expect, test } from 'bun:test'
import { capsNote, lowerCapsProblem, raiseCapsProblem } from './caps'

const now = { maxDealAmount: 1_000n, maxLocked: 10_000n }

describe('cap rules match the escrow', () => {
  test('lowering: both above zero, neither higher than now', () => {
    expect(lowerCapsProblem(now, { maxDealAmount: 500n, maxLocked: 10_000n })).toBeNull()
    expect(lowerCapsProblem(now, now)).toBeNull()
    expect(lowerCapsProblem(now, { maxDealAmount: 0n, maxLocked: 1n })).toContain('above zero')
    expect(lowerCapsProblem(now, { maxDealAmount: 1_001n, maxLocked: 1n })).toContain('schedule a raise')
  })
  test('raising: neither lower than now, at least one higher', () => {
    expect(raiseCapsProblem(now, { maxDealAmount: 1_000n, maxLocked: 20_000n })).toBeNull()
    expect(raiseCapsProblem(now, now)).toContain('at least one')
    expect(raiseCapsProblem(now, { maxDealAmount: 999n, maxLocked: 20_000n })).toContain('lower them instead')
  })
  test('notes a per-deal limit above the total', () => {
    expect(capsNote({ maxDealAmount: 2n, maxLocked: 1n })).not.toBeNull()
    expect(capsNote(now)).toBeNull()
  })
})
