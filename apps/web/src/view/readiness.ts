import { formatDateTime } from './format'
import type { DealView } from './types'

export type Readiness = { ok: true } | { ok: false; reason: string }

/** What the buyer can do about a deal that is not funded yet, read from the escrow's own rules. */
export function fundReadiness(deal: DealView, missing: string[]): Readiness {
  if (deal.state === 'accepted') return { ok: true }
  if (deal.state !== 'proposed') return { ok: false, reason: 'This deal can no longer be funded.' }
  if (deal.chainTime > deal.acceptanceDeadline) return { ok: false, reason: 'The acceptance deadline has passed, so this deal can no longer be funded.' }
  return { ok: false, reason: missing.length ? `Waiting for ${missing.join(', ')} to accept.` : 'Waiting for everyone named to accept.' }
}

/** Cancelling an unaccepted deal is allowed by the escrow only after its acceptance deadline. */
export function cancelReadiness(deal: DealView): Readiness {
  if (deal.state !== 'proposed') return { ok: false, reason: 'Only a deal that is still waiting for acceptance can be cancelled.' }
  if (deal.chainTime <= deal.acceptanceDeadline) {
    return { ok: false, reason: `Can be cancelled after the acceptance deadline, ${formatDateTime(deal.acceptanceDeadline)}.` }
  }
  return { ok: true }
}

/** Whether the buyer's USDC covers what funding locks. Never a guess: an unread balance is not ready. */
export function balanceReadiness(balance: bigint, needed: bigint, format: (v: bigint) => string): Readiness {
  if (balance >= needed) return { ok: true }
  return { ok: false, reason: `Not enough USDC: this deal locks ${format(needed)} and your wallet holds ${format(balance)}.` }
}
