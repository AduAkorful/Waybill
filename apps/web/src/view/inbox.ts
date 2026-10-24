import type { Address } from 'viem'
import { formatAmount } from './format'
import { isClosed } from './derive'
import type { DealView, Tranche } from './types'
import type { Shell } from './wallet'

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/** What this wallet has to do next on a deal, in one word, or null when nothing is waiting on it. Read from the escrow only. */
export function needsFrom(shell: Shell, d: DealView, wallet: Address): string | null {
  if (d.state === 'settled' || d.state === 'cancelled') return null
  switch (shell) {
    case 'buyer':
      if (d.tranches.some((t) => t.state === 'in_review')) return 'Review'
      if (d.state === 'accepted') return 'Fund'
      if (d.tranches.some((t) => t.state === 'refundable')) return 'Refund'
      return null
    case 'supplier':
      if (d.state === 'proposed' && d.supplierPayout === null) return 'Accept'
      if (d.tranches.some((t) => t.state === 'disputed' && !t.responseSubmitted && t.disputeRaiser !== null && !same(t.disputeRaiser, wallet))) {
        return 'Respond'
      }
      return null
    case 'attestor': {
      const mine = d.tranches.filter((t) => t.attestor !== null && same(t.attestor, wallet))
      if (d.state === 'proposed' && mine.some((t) => !t.attestorAccepted)) return 'Accept'
      if (d.state === 'funded' && mine.some((t) => !t.attested && (t.state === 'waiting' || t.state === 'overdue'))) return 'Sign'
      return null
    }
    case 'arbiter':
      if (d.state === 'proposed' && same(d.arbiter, wallet) && !d.arbiterAccepted) return 'Accept'
      if (same(d.arbiter, wallet) && d.tranches.some((t) => t.state === 'disputed' && d.chainTime >= t.responseDeadline)) return 'Decide'
      return null
  }
}

export type Section = 'needs' | 'waiting' | 'done'

export function sectionOf(shell: Shell, d: DealView, wallet: Address): Section {
  if (d.state === 'settled' || d.state === 'cancelled') return 'done'
  return needsFrom(shell, d, wallet) ? 'needs' : 'waiting'
}

/** One plain line about where a deal stands, from the escrow's own states. */
export function statusLine(d: DealView): string {
  const money = (t: Tranche) => `${formatAmount(t.amount)} USDC`
  if (d.state === 'cancelled') return 'Cancelled before funding'
  if (d.state === 'settled') return 'Settled · every part paid out or refunded'
  if (d.state === 'proposed') return 'Waiting for everyone named to accept'
  if (d.state === 'accepted') return 'Everyone accepted · waiting to be funded'
  const disputed = d.tranches.find((t) => t.state === 'disputed')
  if (disputed) return `Part ${disputed.index} is disputed · ${money(disputed)} frozen until it is decided`
  const review = d.tranches.find((t) => t.state === 'in_review')
  if (review) return `Part ${review.index} confirmed · buyer review is open`
  const refundable = d.tranches.find((t) => t.state === 'refundable')
  if (refundable) return `Part ${refundable.index} was never confirmed · refund available`
  if (d.tranches.some((t) => t.state === 'claimable')) return 'Paying the supplier now'
  const next = d.tranches.find((t) => !isClosed(t))
  return next ? `Part ${next.index} of ${d.tranches.length} is next` : 'In progress'
}
