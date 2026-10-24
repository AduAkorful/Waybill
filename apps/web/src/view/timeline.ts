import { formatAmount } from './format'
import type { DealEvent } from './types'

function amount(value: unknown): string | null {
  return typeof value === 'string' && /^\d+$/.test(value) ? `${formatAmount(BigInt(value))} USDC` : null
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
      return `Part${part} returned to the buyer${amount(a.amount) ? `: ${amount(a.amount)}` : ''}`
    case 'MilestoneRefundable':
      return `Part${part} can now be refunded`
    case 'DealSettled':
      return 'Deal settled'
    case 'DealCancelled':
      return 'Deal cancelled before funding'
    case 'PayoutChangeProposed':
      return 'A new payout wallet was proposed; it takes effect after the buyer’s review delay'
    case 'PayoutChangeRejected':
      return 'The proposed payout wallet change was rejected'
    case 'PayoutChangeApplied':
      return 'The supplier’s payout wallet changed'
    case 'RefundChangeProposed':
      return 'A new refund wallet was proposed; it takes effect after the supplier’s review delay'
    case 'RefundChangeRejected':
      return 'The proposed refund wallet change was rejected'
    case 'RefundChangeApplied':
      return 'The buyer’s refund wallet changed'
    default:
      return e.name
  }
}
