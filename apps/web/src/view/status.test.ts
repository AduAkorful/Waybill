import { describe, expect, test } from 'bun:test'
import { dealHeadline } from './status'
import type { DealEvent, DealView } from './types'

const d = (state: string, parts: string[]) => ({ state, tranches: parts.map((s) => ({ state: s })) }) as unknown as DealView

describe('dealHeadline', () => {
  test('a funded deal with a dispute says so', () => {
    expect(dealHeadline(d('funded', ['released', 'disputed', 'disputed']))).toBe('Funded · 2 parts in dispute')
    expect(dealHeadline(d('funded', ['disputed']))).toBe('Funded · 1 part in dispute')
  })
  test('otherwise the plain state', () => {
    expect(dealHeadline(d('funded', ['waiting']))).toBe('Funded')
    expect(dealHeadline(d('settled', ['released']))).toBe('Settled')
  })
})

import { statusLine } from './inbox'

describe('statusLine for a named party', () => {
  const proposed = { state: 'proposed', tranches: [] } as unknown as DealView
  test('tells a wallet that must accept to accept', () => {
    expect(statusLine(proposed, 'Accept')).toContain('accept your role')
    expect(statusLine(proposed, null)).toBe('Waiting for everyone named to accept')
  })
})

import { groupHistory } from './attestor'

describe('groupHistory', () => {
  const ev = (kind: number, time: bigint, tx: string) => ({ name: 'OutcomeRecorded', args: { kind }, time, txHash: tx }) as unknown as DealEvent
  test('collapses runs of the same event and keeps the order', () => {
    const groups = groupHistory([ev(0, 1n, '0xa'), ev(0, 2n, '0xb'), ev(0, 3n, '0xc'), ev(1, 4n, '0xd'), ev(0, 5n, '0xe')])
    expect(groups.map((g) => [g.count, g.first, g.last, g.lastTx])).toEqual([[3, 1n, 3n, '0xc'], [1, 4n, 4n, '0xd'], [1, 5n, 5n, '0xe']])
  })
})
