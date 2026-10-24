import { formatAmount, formatDateTime } from './format'
import type { DealEvent } from './types'

function amount(value: unknown): string | null {
  return typeof value === 'string' && /^\d+$/.test(value) ? `${formatAmount(BigInt(value))} USDC` : null
}

/** The refund in one figure, saying when the buyer's prepaid fee is included, so it matches the deal page. */
function refundAmount(principal: unknown, fee: unknown): string {
  const p = typeof principal === 'string' && /^\d+$/.test(principal) ? BigInt(principal) : null
  if (p === null) return ''
  const f = typeof fee === 'string' && /^\d+$/.test(fee) ? BigInt(fee) : 0n
  return f > 0n ? `: ${formatAmount(p + f)} USDC (${formatAmount(p)} part + ${formatAmount(f)} prepaid fee)` : `: ${formatAmount(p)} USDC`
}

/** A panel vote in words: 1 is for the buyer, 2 for the supplier, 3 + bps is a split. */
function panelVote(value: unknown): string | null {
  const v = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : null
  if (v === 1) return 'for the buyer'
  if (v === 2) return 'for the supplier'
  if (v !== null && v > 3 && v <= 10_003) return `split, ${((v - 3) / 100).toFixed(2).replace(/\.?0+$/, '')}% to the supplier`
  return null
}

/**
 * One event in plain words, from the event's own arguments. An event this list does not know is shown by its
 * contract name rather than hidden or guessed at.
 */
export function describeEvent(e: DealEvent): string {
  const part = e.position === null ? '' : ` ${e.position + 1}`
  const a = e.args
  switch (e.name) {
    case 'DealCreated':
      return 'Deal created'
    case 'SupplierAccepted':
      return 'Supplier accepted and set a payout wallet'
    case 'AttestorAccepted':
      return `An attestor accepted part${part}`
    case 'ArbiterAccepted':
      return 'The arbiter accepted'
    case 'PanelMemberAccepted':
      return 'A panel arbiter accepted'
    case 'PanelVoteCast':
      return `A panel arbiter voted on part${part}${panelVote(a.vote) ? `: ${panelVote(a.vote)}` : ''}`
    case 'PanelResolved':
      return `The panel decided part${part}${panelVote(a.winningVote) ? `: ${panelVote(a.winningVote)}` : ''}`
    case 'DealFunded':
      return `Funded${amount(a.totalAmount) ? `: ${amount(a.totalAmount)} locked in escrow` : ''}`
    case 'AttestationSubmitted':
      return `An attestor signed part${part}`
    case 'ThresholdMet':
      return `Enough attestors signed part${part}`
    case 'ReviewWindowStarted':
      return `Review window opened on part${part}`
    case 'MilestoneApprovedEarly':
      return `Buyer approved part${part}`
    case 'MilestoneClaimable':
      return `Part${part} became claimable`
    case 'TrancheClaimed':
      return `Part${part} paid${amount(a.amount) ? `: ${amount(a.amount)}` : ''}`
    case 'PayoutFailed':
      return `Payment of part${part} could not be delivered and will be retried`
    case 'DisputeRaised':
      return `Part${part} disputed`
    case 'DisputeResponseAdded':
      return `A response was filed on part${part}`
    case 'ArbiterDeadlineReset':
      return `The arbiter's deadline on part${part} is now ${typeof a.arbiterDeadline === 'string' || typeof a.arbiterDeadline === 'number' ? formatDateTime(BigInt(a.arbiterDeadline)) : 'reset from the response'}`
    case 'DisputeEvidenceAppended':
      return `Evidence was added on part${part}`
    case 'DisputeWithdrawn':
      return `Dispute on part${part} withdrawn`
    case 'DisputeResolved':
      return `The arbiter decided part${part} for the ${a.toSupplier === true ? 'supplier' : 'buyer'}`
    case 'TrancheSplit':
      return `The arbiter split part${part}${amount(a.supplierAmount) ? `: supplier ${amount(a.supplierAmount)}` : ''}`
    case 'DefaultApplied':
      return `Arbiter deadline passed on part${part}; the default applied`
    case 'TrancheRefunded':
      return `Part${part} returned to the buyer${refundAmount(a.amount, a.feeRefunded)}`
    case 'MilestoneRefundable':
      return `Part${part} can now be refunded`
    case 'DealSettled':
      return 'Deal settled'
    case 'DealCancelled':
      return 'Deal cancelled before funding'
    case 'PayoutChangeProposed':
      return 'A new payout wallet was proposed; it takes effect after the 48-hour delay unless the other side rejects it'
    case 'PayoutChangeRejected':
      return 'The proposed payout wallet change was rejected'
    case 'PayoutChangeApplied':
      return 'The supplier’s payout wallet changed'
    case 'RefundChangeProposed':
      return 'A new refund wallet was proposed; it takes effect after the 48-hour delay unless the other side rejects it'
    case 'RefundChangeRejected':
      return 'The proposed refund wallet change was rejected'
    case 'RefundChangeApplied':
      return 'The buyer’s refund wallet changed'
    case 'ArbiterFeeCredited':
      return `Arbiter fee${amount(a.amount) ? ` ${amount(a.amount)}` : ''} credited to the arbiter (claimable until they withdraw it)`
    case 'ArbiterFeeRefunded':
      return `Arbiter fee${amount(a.amount) ? ` ${amount(a.amount)}` : ''} returned to the buyer`
    case 'ArbiterFeeRefundPending':
      return `Arbiter fee${amount(a.amount) ? ` ${amount(a.amount)}` : ''} owed back to the buyer; the transfer failed and can be retried`
    case 'FeesWithdrawn':
      return `Fees withdrawn${amount(a.amount) ? `: ${amount(a.amount)}` : ''}`
    default:
      return e.name
  }
}

/** One history row: every event of one transaction on one part, described once, so a decision and its payout share a row and a hash. */
export interface HistoryRow {
  key: string
  first: DealEvent
  text: string
}

export function historyRows(events: readonly DealEvent[]): HistoryRow[] {
  const rows: HistoryRow[] = []
  const byKey = new Map<string, { row: HistoryRow; evs: DealEvent[] }>()
  for (const e of events) {
    const key = `${e.txHash}:${e.position ?? '-'}`
    const hit = byKey.get(key)
    if (hit) hit.evs.push(e)
    else {
      const entry = { row: { key, first: e, text: '' }, evs: [e] }
      byKey.set(key, entry)
      rows.push(entry.row)
    }
  }
  for (const { row, evs } of byKey.values()) {
    // The panel's own resolution already says who won; the escrow's DisputeResolved in the same tx would say it again
    const panel = events.some((e) => e.name === 'PanelResolved' && e.txHash === row.first.txHash)
    const texts = evs.filter((e) => !(panel && e.name === 'DisputeResolved')).map(describeEvent)
    row.text = [...new Set(texts)].join(' · ')
  }
  return rows
}
