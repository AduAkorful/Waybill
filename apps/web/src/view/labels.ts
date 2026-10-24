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

export type Lang = 'en' | 'zh'

/** Who or what must confirm the part, in plain words, from the contract's own condition. */
export function confirmationText(t: Tranche, lang: Lang = 'en'): string {
  const zh = lang === 'zh'
  switch (t.condition) {
    case 'acceptance':
      return zh ? '供应商接受且买方注资后付款' : 'Paid when the supplier accepts and the buyer funds'
    case 'attestation':
      if (!t.attestor) return zh ? '等待证明人签署' : 'Waits for an attestor to confirm'
      if (t.threshold > 1) {
        return zh
          ? `需要 ${t.threshold} 位证明人确认交付（已确认 ${t.attestCount} 位），首位：${shortAddress(t.attestor)}`
          : `Needs ${t.threshold} attestors to confirm delivery (${t.attestCount} so far), starting with ${shortAddress(t.attestor)}`
      }
      return zh ? `由 ${shortAddress(t.attestor)} 确认交付` : `To be confirmed by ${shortAddress(t.attestor)}`
    case 'buyer_approval':
      return zh ? '买方批准后，或审核期结束后放款' : 'Released when the buyer approves, or the review window ends'
    case 'timed':
      return zh ? '到期日放款，除非买方提出争议' : 'Released on the due date unless the buyer disputes it'
  }
}

/** Footer wording for a part in a final or frozen state. */
export const footerText = {
  released: { en: 'Paid to the supplier', zh: '已付给供应商' },
  refunded: { en: 'Returned to the buyer', zh: '已退还买方' },
  resolved: { en: 'Decided by the arbiter', zh: '已由仲裁人裁决' },
  disputed: { en: 'Frozen until the arbiter decides.', zh: '冻结，等待仲裁人裁决。' },
  otherParts: { en: 'Other parts are not affected.', zh: '其他各期不受影响。' },
  objectUntil: { en: 'Buyer can object until', zh: '买方可提出异议至' },
} as const
