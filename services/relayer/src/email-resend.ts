import type { EmailDelivery, EmailProvider } from './notification-dispatcher'
import { renderEmail } from './email-render'

export interface ResendOptions {
  apiKey: string
  /** "Waybill <notify@your-domain>" */
  from: string
  /** Where the links in the emails point */
  webUrl: string
  endpoint?: string
}

/** Sends one email through Resend's HTTP API. An unknown template or a refused request throws, so the outbox retries. */
export class ResendEmailProvider implements EmailProvider {
  constructor(
    private readonly options: ResendOptions,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async send(delivery: EmailDelivery): Promise<void> {
    const mail = renderEmail(delivery.template, delivery.payload, this.options.webUrl)
    if (!mail) throw new Error(`No email is defined for template ${delivery.template}`)
    const response = await this.fetcher(this.options.endpoint ?? 'https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.options.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: this.options.from, to: [delivery.to], subject: mail.subject, text: mail.text, html: mail.html }),
    })
    if (!response.ok) throw new Error(`Email provider refused the message (${response.status})`)
  }
}
