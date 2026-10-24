import { describe, expect, test } from 'bun:test'
import { buyerFee, supplierFee } from './derive'
import { formatAmount, formatDateTime, shortAddress, toCents } from './format'
import { trancheAmounts } from './from-chain'
import { describeAttestorEvent, parseAttestor, parseAttestors } from './attestor'
import { parseDealEvents, splitDecisions } from './events'
import { refundedFor, releasedFor, splitBuyerReceives, unknownSplitParts } from './derive'
import type { DealView, Tranche } from './types'

const part = (fee: bigint) => ({ fee }) as Tranche

describe('formatAmount', () => {
  test('shows two decimals and never rounds sub-cent digits away', () => {
    expect(formatAmount(20_250_000_000n)).toBe('20,250.00')
    expect(formatAmount(7_500n)).toBe('0.0075')
    expect(formatAmount(1_000_000n)).toBe('1.00')
    expect(formatAmount(0n)).toBe('0.00')
  })
  test('rounds to cents half up only for counters', () => {
    expect(toCents(7_500n)).toBe(1)
    expect(toCents(4_999n)).toBe(0)
  })
})

describe('trancheAmounts', () => {
  test('follows the contract: floor for all but the last, remainder to the last', () => {
    const out = trancheAmounts(1_000_001n, [3333n, 3333n, 3334n])
    expect(out).toEqual([333_300n, 333_300n, 333_401n])
    expect(out.reduce((a, b) => a + b, 0n)).toBe(1_000_001n)
  })
})

describe('fee split', () => {
  test('buyer pays all, supplier none, or the buyer half rounds up', () => {
    expect(buyerFee(part(7n), 'buyer')).toBe(7n)
    expect(buyerFee(part(7n), 'supplier')).toBe(0n)
    expect(buyerFee(part(7n), 'split')).toBe(4n)
    expect(supplierFee(part(7n), 'split')).toBe(3n)
  })
})

describe('time and address', () => {
  test('formats UTC', () => {
    expect(formatDateTime(1_792_962_911n)).toBe('25 Oct 2026, 21:15 GMT')
  })
  test('shortens long values only', () => {
    expect(shortAddress('0x4632A278FEb0a4D249561e7fC3f3708C4329D0F1')).toBe('0x4632…D0F1')
    expect(shortAddress('0x1234')).toBe('0x1234')
  })
})

describe('arbiter splits', () => {
  const hash = `0x${'ab'.repeat(32)}`
  const rows = [
    { eventName: 'DealCreated', blockNumber: '5', logIndex: '0', transactionHash: hash, milestoneIndex: null, blockTimestamp: '1700000000', payload: {} },
    {
      eventName: 'TrancheSplit', blockNumber: '9', logIndex: '2', transactionHash: hash, milestoneIndex: 0, blockTimestamp: null,
      payload: { supplierBps: '6000', supplierAmount: '600000', buyerAmount: '400000' },
    },
  ]
  // principal 1,000,000 with a 10,000 fee the buyer prepaid, split 60/40 in the supplier's favour
  const deal = {
    feePayer: 'buyer',
    state: 'funded',
    arbiterFee: 0n,
    tranches: [{ position: 0, state: 'resolved', amount: 1_000_000n, fee: 10_000n }],
  } as unknown as DealView

  test('parses the relayer list and reads block time as optional', () => {
    const events = parseDealEvents(rows)
    expect(events[0]?.time).toBe(1_700_000_000n)
    expect(events[1]?.time).toBeNull()
    expect(splitDecisions(events)).toEqual([
      { position: 0, supplierBps: 6000, supplierAmount: 600_000n, buyerPrincipal: 400_000n },
    ])
  })

  test('rejects malformed rows instead of showing part of a history', () => {
    expect(() => parseDealEvents({})).toThrow()
    expect(() => parseDealEvents([{ ...rows[0], transactionHash: '0x12' }])).toThrow('transaction hash')
    expect(() => parseDealEvents([{ ...rows[0], blockNumber: 5 }])).toThrow('blockNumber')
  })

  test('counts a split part once its event is known, matching the contract', () => {
    const decision = { position: 0, supplierBps: 6000, supplierAmount: 600_000n, buyerPrincipal: 400_000n }
    expect(unknownSplitParts(deal)).toHaveLength(1)
    expect(releasedFor(deal)).toBe(0n)
    const known = { ...deal, splits: [decision] }
    expect(unknownSplitParts(known)).toHaveLength(0)
    expect(releasedFor(known)).toBe(600_000n)
    // the buyer gets 400,000 principal back plus 40% of the 10,000 fee they prepaid
    expect(splitBuyerReceives(known, known.tranches[0]!, decision)).toBe(404_000n)
    expect(refundedFor(known)).toBe(404_000n)
  })
})

describe('attestor model', () => {
  const who = `0x${'ab'.repeat(20)}`
  const row = { address: who, status: 'registered', attested: 12, upheld: 1, slashed: 0, profile: { name: 'Lin Mei', city: 'Ningbo', agentId: '0' }, pending: null }

  test('parses the relayer record and an absent profile', () => {
    expect(parseAttestor(row)).toMatchObject({ address: who, attested: 12, profile: { name: 'Lin Mei', agentId: 0n }, pending: null })
    expect(parseAttestor({ ...row, profile: null }).profile).toBeNull()
    expect(parseAttestor({ ...row, pending: { status: 'suspended', eta: '1800000000', automatic: true } }).pending).toEqual({ status: 'suspended', eta: 1_800_000_000n, automatic: true })
  })

  test('rejects anything it does not understand instead of showing a partial directory', () => {
    expect(() => parseAttestors({})).toThrow()
    expect(() => parseAttestor({ ...row, address: '0x12' })).toThrow('invalid address')
    expect(() => parseAttestor({ ...row, status: 'gold' })).toThrow('status')
    expect(() => parseAttestor({ ...row, attested: '12' })).toThrow('attested count')
  })

  test('words registry events from their own arguments', () => {
    const ev = (name: string, args: Record<string, unknown>) => ({ name, args, position: null, blockNumber: 1n, logIndex: 0n, txHash: `0x${'aa'.repeat(32)}` as `0x${string}`, time: null })
    expect(describeAttestorEvent(ev('OutcomeRecorded', { kind: 1 }))).toContain('decided against')
    expect(describeAttestorEvent(ev('StatusExecuted', { status: 2 }))).toContain('suspended')
    expect(describeAttestorEvent(ev('SomethingNew', {}))).toBe('SomethingNew')
  })
})
