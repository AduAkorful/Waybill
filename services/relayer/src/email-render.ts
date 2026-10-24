import type { NotifyRole } from './notification-planner'

export interface RenderedEmail {
  subject: string
  text: string
  html: string
}

const PAGE: Record<NotifyRole, (deal: string) => string> = {
  buyer: (d) => `/app/deals/${d}`,
  supplier: (d) => `/d/${d}`,
  attestor: (d) => `/app/attest/${d}`,
  arbiter: (d) => `/app/room/${d}`,
}

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

interface Words {
  subject: string
  line: string
}

/** Plain, short wording per message. It names the deal and the part and nothing commercial. */
function words(template: string, data: Record<string, string>): Words | null {
  const deal = data.deal ?? '?'
  const part = data.part ? ` part ${data.part}` : ''
  switch (template) {
    case 'invited':
      return { subject: `You were named in Waybill deal ${deal}`, line: `You were named in deal ${deal}. Open it to read the terms and accept. Nothing moves until everyone has accepted.` }
    case 'accepted':
      return { subject: `${data.by ?? 'Someone'} accepted deal ${deal}`, line: `${data.by ?? 'Someone'} accepted deal ${deal}. You can fund it once everyone named has accepted.` }
    case 'funded':
      return { subject: `Deal ${deal} is funded`, line: `The buyer locked the money for deal ${deal} in escrow. The work can start.` }
    case 'confirmed':
      return { subject: `Deal ${deal}${part} was confirmed`, line: `The named people confirmed${part} of deal ${deal}. Review it before the review window closes.` }
    case 'paid':
      return { subject: `Deal ${deal}${part} was paid`, line: `Payment for${part} of deal ${deal} was sent to the supplier.` }
    case 'payout_failed':
      return { subject: `Payment on deal ${deal}${part} could not be delivered`, line: `Sending${part} of deal ${deal} to the payout wallet failed. The money is safe in escrow; open the deal to retry.` }
    case 'refund_failed':
      return { subject: `Refund on deal ${deal}${part} could not be delivered`, line: `Sending the refund for${part} of deal ${deal} failed. The money is safe in escrow; open the deal to retry.` }
    case 'refundable':
      return { subject: `Deal ${deal}${part} can be refunded`, line: `${part ? part.trim() : 'A part'} of deal ${deal} passed its deadline without confirmation. You can take the money back.` }
    case 'dispute_raised':
      return { subject: `A dispute was raised on deal ${deal}${part}`, line: `A dispute was raised on${part} of deal ${deal}. The money for that part is held until it is decided. Open the room to respond or add evidence.` }
    case 'dispute_response':
      return { subject: `A response was filed on deal ${deal}${part}`, line: `A response was filed on the dispute on${part} of deal ${deal}. Open the room to see when the arbiter can decide.` }
    case 'rebuttal_waived':
      return { subject: `You can decide the dispute on deal ${deal}${part}`, line: `The side who raised the dispute on${part} of deal ${deal} has nothing to add to the response, so you can decide it now.` }
    case 'dispute_withdrawn':
      return { subject: `The dispute on deal ${deal}${part} was withdrawn`, line: `The buyer withdrew the dispute on${part} of deal ${deal}.` }
    case 'dispute_decided':
      return { subject: `The dispute on deal ${deal}${part} was decided`, line: `The dispute on${part} of deal ${deal} has been decided. Open the deal to see the outcome.` }
    case 'payout_change':
      return { subject: `The supplier proposed a new payout wallet on deal ${deal}`, line: `A new payout wallet was proposed for deal ${deal}. It takes effect after 48 hours unless you reject it. Check that it is right.` }
    case 'refund_change':
      return { subject: `The buyer proposed a new refund wallet on deal ${deal}`, line: `A new refund wallet was proposed for deal ${deal}. It takes effect after 48 hours unless you reject it. Check that it is right.` }
    case 'settled':
      return { subject: `Deal ${deal} is settled`, line: `Every part of deal ${deal} has been paid out or refunded.` }
    case 'cancelled':
      return { subject: `Deal ${deal} was cancelled`, line: `Deal ${deal} was cancelled before it was funded. Nothing was locked.` }
    default:
      return null
  }
}

/** The email for one outbox message. Returns null for a template it does not know, so nothing unknown is ever sent. */
export function renderEmail(template: string, payload: Record<string, unknown>, webUrl: string): RenderedEmail | null {
  const data = Object.fromEntries(Object.entries(payload).map(([k, v]) => [k, String(v)]))
  const role = data.role as NotifyRole | undefined
  if (template === 'verify_email') {
    const link = `${webUrl.replace(/\/+$/, '')}/verify-email?token=${encodeURIComponent(data.token ?? '')}`
    const text = `Confirm this email address to get Waybill updates for your wallet.\n\n${link}\n\nThe link works for 48 hours. If you did not ask for this, ignore it and nothing will be sent to you.`
    return { subject: 'Confirm your email for Waybill', text, html: `<p>Confirm this email address to get Waybill updates for your wallet.</p><p><a href="${escapeHtml(link)}">Confirm my email</a></p><p>The link works for 48 hours. If you did not ask for this, ignore it and nothing will be sent to you.</p>` }
  }
  const w = words(template, data)
  if (!w || !role || !(role in PAGE)) return null
  const link = `${webUrl.replace(/\/+$/, '')}${PAGE[role](data.deal ?? '')}`
  return {
    subject: w.subject,
    text: `${w.line}\n\n${link}\n\nYou get these because you added this address in Waybill settings. Turn them off there at any time.`,
    html: `<p>${escapeHtml(w.line)}</p><p><a href="${escapeHtml(link)}">Open deal ${escapeHtml(data.deal ?? '')}</a></p><p style="color:#666;font-size:12px">You get these because you added this address in Waybill settings. Turn them off there at any time.</p>`,
  }
}
