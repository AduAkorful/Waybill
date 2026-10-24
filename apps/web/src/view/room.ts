import type { Tranche } from './types'

/** Where a disputed part stands in its clock: the other side may respond, then the arbiter may decide, then the default applies. */
export type DisputeStage = 'response_open' | 'decision_open' | 'deadline_passed'

/**
 * Mirrors the escrow: decisions open after `responseDeadline` and stay open until `arbiterDeadline` inclusive.
 * With `early` (a deployment whose escrow has the decide-after-response rule) they also open as soon as the other side
 * has responded; that escrow resets `arbiterDeadline` from the response time.
 */
export function disputeStage(
  part: Pick<Tranche, 'responseDeadline' | 'arbiterDeadline' | 'responseSubmitted'>,
  chainTime: bigint,
  early: boolean,
): DisputeStage {
  if (!(early && part.responseSubmitted) && chainTime <= part.responseDeadline) return 'response_open'
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
