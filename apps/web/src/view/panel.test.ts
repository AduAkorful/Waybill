import { describe, expect, test } from 'bun:test'
import { decodeVote, describeVote, encodeVote, panelAccepted, panelOutcome } from './panel'
import type { DealView } from './types'

describe('panel vote encoding', () => {
  test('matches the escrow: 1 buyer, 2 supplier, 4 and up is a split offset by 3', () => {
    expect(encodeVote({ kind: 'buyer' })).toBe(1)
    expect(encodeVote({ kind: 'supplier' })).toBe(2)
    expect(encodeVote({ kind: 'split', supplierBps: 6000 })).toBe(6003)
    expect(encodeVote({ kind: 'split', supplierBps: 1 })).toBe(4)
    expect(encodeVote({ kind: 'split', supplierBps: 9999 })).toBe(10_002)
  })
  test('refuses a split that is really a full payout or refund, and decodes only valid votes', () => {
    expect(() => encodeVote({ kind: 'split', supplierBps: 0 })).toThrow()
    expect(() => encodeVote({ kind: 'split', supplierBps: 10_000 })).toThrow()
    expect(decodeVote(0)).toBeNull()
    expect(decodeVote(3)).toBeNull()
    expect(decodeVote(10_003)).toBeNull()
    expect(decodeVote(6003)).toEqual({ kind: 'split', supplierBps: 6000 })
    expect(describeVote(6003)).toBe('Split: supplier 60.00%, buyer 40.00%')
  })
})

describe('panel outcome', () => {
  const s = (...votes: number[]) => votes.map((vote, i) => ({ member: `0x${String(i + 1).repeat(40)}` as `0x${string}`, vote }))
  test('two matching votes decide; two different votes leave it open', () => {
    expect(panelOutcome(s(1, 1, 0))).toBe('decided')
    expect(panelOutcome(s(2, 1, 0))).toBe('open')
    expect(panelOutcome(s(6003, 6003, 1))).toBe('decided')
    expect(panelOutcome(s(0, 0, 0))).toBe('open')
  })
})

describe('panel acceptance', () => {
  const members = ['0x' + '1'.repeat(40), '0x' + '2'.repeat(40), '0x' + '3'.repeat(40)] as `0x${string}`[]
  const deal = (over: Partial<DealView>) => ({ panel: { members, votes: {} }, arbiterAccepted: false, ...over }) as DealView
  test('everyone has accepted once the escrow says so', () => {
    expect(Object.values(panelAccepted(deal({ arbiterAccepted: true }))!)).toEqual([true, true, true])
  })
  test('otherwise it comes from the indexed events, and is unknown without them', () => {
    expect(panelAccepted(deal({}))).toBeNull()
    const events = [{ name: 'PanelMemberAccepted', args: { member: members[1] } }] as unknown as DealView['events']
    expect(Object.values(panelAccepted(deal({ events }))!)).toEqual([false, true, false])
  })
})
