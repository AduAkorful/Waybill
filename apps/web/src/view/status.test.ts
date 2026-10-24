import { describe, expect, test } from 'bun:test'
import { dealHeadline } from './status'
import type { DealView } from './types'

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
