import { describe, expect, test } from 'bun:test'
import { hasSigned } from './events'
import type { DealEvent } from './types'

const ev = (name: string, position: number, attestor: string) => ({ name, position, args: { attestor } }) as unknown as DealEvent

describe('hasSigned', () => {
  const events = [ev('AttestationSubmitted', 0, '0xAbC'), ev('AttestorAccepted', 1, '0xdef')]
  test('finds this wallet on this part, ignoring case', () => {
    expect(hasSigned(events, 0, '0xabc')).toBe(true)
  })
  test('other parts, other wallets, other events and no events do not count', () => {
    expect(hasSigned(events, 1, '0xabc')).toBe(false)
    expect(hasSigned(events, 0, '0xdef')).toBe(false)
    expect(hasSigned(events, 1, '0xdef')).toBe(false)
    expect(hasSigned(undefined, 0, '0xabc')).toBe(false)
  })
})
