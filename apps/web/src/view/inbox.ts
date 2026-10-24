import { disputeStage } from './room'
import { earlyResolve } from '@/integration/network'
import type { Address } from 'viem'
import { formatAmount } from './format'
import { isClosed } from './derive'
import { isArbiterOf, panelAccepted, panelStanding } from './panel'
import type { DealView, Tranche } from './types'
import type { Shell } from './wallet'

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/** A buyer-approval part nobody has acted on: only the buyer's approve moves it (there is no supplier "delivered" call). */
const awaitsBuyerConfirm = (t: Tranche) => t.state === 'waiting' && t.condition === 'buyer_approval'

/** What this wallet has to do next on a deal, in one word, or null when nothing is waiting on it. Read from the escrow only. */
export function needsFrom(shell: Shell, d: DealView, wallet: Address): string | null {
  if (d.state === 'settled' || d.state === 'cancelled') return null
  switch (shell) {
    case 'buyer':
      if (d.tranches.some((t) => t.state === 'in_review')) return 'Review'
      if (d.state === 'accepted') return 'Fund'
      if (d.tranches.some((t) => t.state === 'refundable')) return 'Refund'
      if (d.state === 'funded' && d.tranches.some(awaitsBuyerConfirm)) return 'Confirm'
      return null
    case 'supplier':
      if (d.state === 'proposed' && d.supplierPayout === null) return 'Accept'
      if (d.tranches.some((t) => t.state === 'disputed' && !t.responseSubmitted && t.disputeRaiser !== null && !same(t.disputeRaiser, wallet))) {
        return 'Respond'
      }
      return null
    case 'attestor': {
      const mine = d.tranches.filter((t) => t.attestors.some((a) => same(a, wallet)))
      if (d.state === 'proposed' && mine.some((t) => !t.attestorAccepted)) return 'Accept'
      if (d.state === 'funded' && mine.some((t) => !t.attested && (t.state === 'waiting' || t.state === 'overdue'))) return 'Sign'
      return null
    }
    case 'arbiter':
      if (!isArbiterOf(d, wallet)) return null
      if (d.state === 'proposed' && !d.arbiterAccepted && panelAccepted(d)?.[wallet.toLowerCase()] !== true) return 'Accept'
      // a panel member who has already voted on a part has nothing left to do on it
      const voted = (t: Tranche) => panelStanding(d, t).some((s) => same(s.member, wallet) && s.vote !== 0)
      if (d.tranches.some((t) => t.state === 'disputed' && disputeStage(t, d.chainTime, earlyResolve()) === 'decision_open' && !voted(t))) return 'Decide'
      return null
  }
}

export type Section = 'needs' | 'waiting' | 'done'

export function sectionOf(shell: Shell, d: DealView, wallet: Address): Section {
  if (d.state === 'settled' || d.state === 'cancelled') return 'done'
  return needsFrom(shell, d, wallet) ? 'needs' : 'waiting'
}

/** One plain line about where a deal stands, from the escrow's own states. */
export function statusLine(d: DealView, needs: string | null = null): string {
  const money = (t: Tranche) => `${formatAmount(t.amount)} USDC`
  if (d.state === 'cancelled') return 'Cancelled before funding'
  if (d.state === 'settled') return 'Settled · every part paid out or refunded'
  if (d.state === 'proposed') return needs === 'Accept' ? 'You are named here · accept your role so the deal can be funded' : 'Waiting for everyone named to accept'
  if (d.state === 'accepted') return 'Everyone accepted · waiting to be funded'
  const disputed = d.tranches.find((t) => t.state === 'disputed')
  if (disputed) return `Part ${disputed.index} is disputed · ${money(disputed)} frozen until it is decided`
  const review = d.tranches.find((t) => t.state === 'in_review')
  if (review) return `Part ${review.index} confirmed · buyer review is open`
  const refundable = d.tranches.find((t) => t.state === 'refundable')
  if (refundable) return `Part ${refundable.index} was never confirmed · refund available`
  if (d.tranches.some((t) => t.state === 'claimable')) return 'Paying the supplier now'
  const confirm = d.tranches.find(awaitsBuyerConfirm)
  if (confirm) return `Part ${confirm.index} of ${d.tranches.length} · waiting for the buyer to confirm delivery`
  const next = d.tranches.find((t) => !isClosed(t))
  return next ? `Part ${next.index} of ${d.tranches.length} is next` : 'In progress'
}
