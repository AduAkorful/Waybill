import type { DealView, FeePayer, MilestoneState, Tranche } from './types'

const CLOSED: readonly MilestoneState[] = ['released', 'refunded', 'resolved']

export const isClosed = (t: Tranche) => CLOSED.includes(t.state)

/** What the buyer deposited toward this part's fee. Mirrors the contract: split rounds the buyer's half up. */
export function buyerFee(t: Tranche, payer: FeePayer): bigint {
  if (payer === 'buyer') return t.fee
  if (payer === 'supplier') return 0n
  return (t.fee + 1n) / 2n
}

/** The share of the fee taken from the supplier's payment. */
export const supplierFee = (t: Tranche, payer: FeePayer): bigint => t.fee - buyerFee(t, payer)

/** Arbiter-split parts: the contract does not expose the split, only the event does. */
export const resolvedParts = (d: DealView) => d.tranches.filter((t) => t.state === 'resolved')

/** Split parts whose TrancheSplit event has not been read. Ledger figures leave these out, so a screen must say so. */
export const unknownSplitParts = (d: DealView) =>
  resolvedParts(d).filter((t) => !d.splits?.some((s) => s.position === t.position))

/** What the buyer gets back from a split part: the returned principal plus their prepaid fee, shared in the same proportion. */
export function splitBuyerReceives(d: DealView, t: Tranche, s: { supplierBps: number; buyerPrincipal: bigint }): bigint {
  return s.buyerPrincipal + (buyerFee(t, d.feePayer) * BigInt(10_000 - s.supplierBps)) / 10_000n
}

const splitFor = (d: DealView, t: Tranche) => d.splits?.find((s) => s.position === t.position)

/** Held in escrow: unfinished parts with the fee the buyer prepaid on them, plus the arbiter fee until it is paid out or returned. */
export function heldFor(d: DealView): bigint {
  if (d.state !== 'funded') return 0n
  const open = d.tranches.filter((t) => !isClosed(t))
  const parts = open.reduce((s, t) => s + t.amount + buyerFee(t, d.feePayer), 0n)
  return parts + (resolvedParts(d).length > 0 ? 0n : d.arbiterFee)
}

/** Paid to the supplier, net of any fee deducted from them. Split parts count only once their event was read; see unknownSplitParts. */
export function releasedFor(d: DealView): bigint {
  const whole = d.tranches.filter((t) => t.state === 'released').reduce((s, t) => s + t.amount - supplierFee(t, d.feePayer), 0n)
  const split = d.tranches.filter((t) => t.state === 'resolved').reduce((s, t) => s + (splitFor(d, t)?.supplierAmount ?? 0n), 0n)
  return whole + split
}

/** Returned to the buyer: refunded parts with their prepaid fee, plus the arbiter fee once a deal settles with no arbiter decision. */
export function refundedFor(d: DealView): bigint {
  const whole = d.tranches.filter((t) => t.state === 'refunded').reduce((s, t) => s + t.amount + buyerFee(t, d.feePayer), 0n)
  const split = d.tranches
    .filter((t) => t.state === 'resolved')
    .reduce((s, t) => {
      const decision = splitFor(d, t)
      return decision ? s + splitBuyerReceives(d, t, decision) : s
    }, 0n)
  const parts = whole + split
  const arbiterBack = d.state === 'settled' && resolvedParts(d).length === 0 ? d.arbiterFee : 0n
  return parts + arbiterBack
}

/** What the buyer locks to fund: principal, their share of fees, and the arbiter fee. Matches the contract's funding transfer. */
export const fundingTotal = (d: DealView): bigint => d.totalAmount + d.prepaidFee + d.arbiterFee

/** The part that currently needs someone's attention, if any. */
export const focusPart = (d: DealView): Tranche | undefined =>
  d.tranches.find((t) => t.state === 'in_review' || t.state === 'claimable' || t.state === 'disputed')

/** The end of a part's buyer review window, unix seconds, or null when none is running. */
export const reviewEnds = (t: Tranche): bigint | null => (t.state === 'in_review' ? t.reviewWindowStart + BigInt(t.reviewWindow) : null)
