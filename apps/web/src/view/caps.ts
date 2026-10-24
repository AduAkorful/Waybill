/** Mirrors the escrow's cap rules so the card never offers a change the contract would refuse. Amounts are raw 6-decimal units. */
export interface Caps {
  maxDealAmount: bigint
  maxLocked: bigint
}

/** Why a lower is refused, or null when the contract would accept it: each cap above zero and none higher than now. */
export function lowerCapsProblem(current: Caps, next: Caps): string | null {
  if (next.maxDealAmount <= 0n || next.maxLocked <= 0n) return 'Both limits must be above zero.'
  if (next.maxDealAmount > current.maxDealAmount || next.maxLocked > current.maxLocked) return 'Lowering cannot raise either limit; schedule a raise instead.'
  return null
}

/** Why a raise is refused, or null: neither cap lower than now and at least one higher. */
export function raiseCapsProblem(current: Caps, next: Caps): string | null {
  if (next.maxDealAmount < current.maxDealAmount || next.maxLocked < current.maxLocked) return 'A raise cannot lower either limit; lower them instead.'
  if (next.maxDealAmount === current.maxDealAmount && next.maxLocked === current.maxLocked) return 'Change at least one limit.'
  return null
}

/** A per-deal cap above the total cap can never be used in full; worth saying, not refusing (the contract allows it). */
export function capsNote(next: Caps): string | null {
  return next.maxDealAmount > next.maxLocked ? 'The per-deal limit is above the total limit, so no single deal can reach it.' : null
}
