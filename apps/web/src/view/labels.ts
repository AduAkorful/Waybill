import { shortAddress } from './format'
import type { Condition, Tranche } from './types'

export const conditionLabel: Record<Condition, string> = {
  acceptance: 'Acceptance',
  attestation: 'Attestation',
  buyer_approval: 'Buyer approval',
  timed: 'Timed release',
}

/** The part's name: the buyer's own title when off-chain terms provide one, otherwise what releases it. */
export const trancheName = (t: Tranche): string => t.title ?? conditionLabel[t.condition]

/** Who or what must confirm the part, in plain words, from the contract's own condition. */
export function confirmationText(t: Tranche): string {
  switch (t.condition) {
    case 'acceptance':
      return 'Paid when the supplier accepts and the buyer funds'
    case 'attestation':
      if (!t.attestor) return 'Waits for an attestor to sign'
      return t.threshold > 1
        ? `Needs ${t.threshold} attestors to sign (${t.attestCount} so far), starting with ${shortAddress(t.attestor)}`
        : `Confirmed by ${shortAddress(t.attestor)}`
    case 'buyer_approval':
      return 'Released when the buyer approves, or the review window ends'
    case 'timed':
      return 'Released on the due date unless the buyer disputes it'
  }
}
