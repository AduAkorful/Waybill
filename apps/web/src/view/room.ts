import type { Tranche } from './types'

/**
 * Where a disputed part stands in its clock: the other side may respond; after a response the raiser has a rebuttal
 * day (on an escrow with that rule); then the arbiter may decide; then the default applies.
 */
export type DisputeStage = 'response_open' | 'rebuttal_open' | 'decision_open' | 'deadline_passed'

/**
 * Mirrors the escrow. Without `early` (the current testnet escrow): decisions open after `responseDeadline` and stay
 * open until `arbiterDeadline` inclusive. With `early`: a response opens decisions at `decisionOpensAt` (a day later,
 * or at once if the raiser waives), and the escrow moves `arbiterDeadline` to run from then. A responded part whose
 * opening time was not read is treated as still in its rebuttal, so nobody is offered a decision the escrow refuses.
 */
export function disputeStage(
  part: Pick<Tranche, 'responseDeadline' | 'arbiterDeadline' | 'responseSubmitted' | 'decisionOpensAt'>,
  chainTime: bigint,
  early: boolean,
): DisputeStage {
  if (early && part.responseSubmitted) {
    if (part.decisionOpensAt === undefined || chainTime < part.decisionOpensAt) return 'rebuttal_open'
  } else if (chainTime <= part.responseDeadline) {
    return 'response_open'
  }
  if (chainTime <= part.arbiterDeadline) return 'decision_open'
  return 'deadline_passed'
}

export const MIN_REASONING = 20

/** The share of a part's principal each side gets from a split, before any fee. The supplier's share rounds down. */
export function splitPrincipal(amount: bigint, supplierBps: number): { supplier: bigint; buyer: bigint } {
  if (!Number.isInteger(supplierBps) || supplierBps < 0 || supplierBps > 10_000) throw new Error('supplierBps must be 0 to 10000')
  const supplier = (amount * BigInt(supplierBps)) / 10_000n
  return { supplier, buyer: amount - supplier }
}

/** Parses a typed percentage such as "60" or "62.5" into basis points, or null when it is not a valid split. */
export function percentToSplitBps(text: string): number | null {
  const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(text.trim())
  if (!m) return null
  const bps = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'))
  return bps >= 1 && bps <= 9_999 ? bps : null
}
