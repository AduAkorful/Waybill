import type { Address } from 'viem'
import type { DealView, Tranche } from './types'

/**
 * The escrow's vote encoding: 1 pays the buyer, 2 pays the supplier, and 4 to 10,003 is a split where the
 * supplier's share in basis points is the vote minus 3. 0 means no vote and 3 is reserved.
 */
export type PanelChoice = { kind: 'buyer' } | { kind: 'supplier' } | { kind: 'split'; supplierBps: number }

export function encodeVote(choice: PanelChoice): number {
  if (choice.kind === 'buyer') return 1
  if (choice.kind === 'supplier') return 2
  if (!Number.isInteger(choice.supplierBps) || choice.supplierBps < 1 || choice.supplierBps > 9_999) {
    throw new Error('A split gives the supplier between 0.01% and 99.99%')
  }
  return choice.supplierBps + 3
}

/** Null for no vote (0) and for the reserved or out-of-range values the escrow refuses. */
export function decodeVote(vote: number): PanelChoice | null {
  if (vote === 1) return { kind: 'buyer' }
  if (vote === 2) return { kind: 'supplier' }
  if (vote >= 4 && vote <= 10_002) return { kind: 'split', supplierBps: vote - 3 }
  return null
}

export function describeVote(vote: number): string {
  const choice = decodeVote(vote)
  if (!choice) return 'Not voted'
  if (choice.kind === 'buyer') return 'Refund the buyer'
  if (choice.kind === 'supplier') return 'Pay the supplier'
  return `Split: supplier ${(choice.supplierBps / 100).toFixed(2)}%, buyer ${((10_000 - choice.supplierBps) / 100).toFixed(2)}%`
}

export const isPanelMember = (d: DealView, wallet: string): boolean =>
  d.panel !== null && d.panel.members.some((m) => m.toLowerCase() === wallet.toLowerCase())

/** True for the single arbiter, or for any of the three panel members. */
export const isArbiterOf = (d: DealView, wallet: string): boolean =>
  d.arbiter.toLowerCase() === wallet.toLowerCase() || isPanelMember(d, wallet)

export interface PanelStanding {
  member: Address
  vote: number
}

/** Each member's vote on one part, in the panel's order. Empty when the deal has no panel. */
export function panelStanding(d: DealView, t: Tranche): PanelStanding[] {
  if (!d.panel) return []
  const cast = d.panel.votes[t.position] ?? {}
  return d.panel.members.map((member) => ({ member, vote: cast[member.toLowerCase()] ?? 0 }))
}

/** What the votes say so far. Two matching votes decide the part, and the escrow acts on them at once. */
export function panelOutcome(standing: readonly PanelStanding[]): 'decided' | 'open' {
  const cast = standing.map((s) => s.vote).filter((v) => v !== 0)
  return cast.some((v, i) => cast.indexOf(v) !== i) ? 'decided' : 'open'
}

/** Members who have not yet accepted the role, from the indexed history. Null when the history is not available. */
export function panelAccepted(d: DealView): Record<string, boolean> | null {
  if (!d.panel) return null
  if (d.arbiterAccepted) return Object.fromEntries(d.panel.members.map((m) => [m.toLowerCase(), true]))
  if (!d.events) return null
  const accepted = new Set(d.events.filter((e) => e.name === 'PanelMemberAccepted').map((e) => String(e.args.member ?? '').toLowerCase()))
  return Object.fromEntries(d.panel.members.map((m) => [m.toLowerCase(), accepted.has(m.toLowerCase())]))
}
