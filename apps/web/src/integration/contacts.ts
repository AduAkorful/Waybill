import type { Hex } from 'viem'
import { loadBrowserApiBaseUrl } from './api'
import { getBrowserNetwork } from './network'

/** The exact text the wallet signs. Must match the relayer's emailMessage character for character. */
export function emailMessage(input: { network: string; chainId: number; wallet: string; action: 'set' | 'read'; email: string; notify: boolean; signedAt: number }): string {
  return [
    'Waybill email settings',
    `action: ${input.action}`,
    `network: ${input.network}`,
    `chain: ${input.chainId}`,
    `wallet: ${input.wallet.toLowerCase()}`,
    `email: ${input.action === 'set' ? input.email.toLowerCase() : '-'}`,
    `notify: ${input.action === 'set' ? (input.notify ? 'yes' : 'no') : '-'}`,
    `signed: ${input.signedAt}`,
  ].join('\n')
}

export interface EmailSettings {
  email: string
  notificationsEnabled: boolean
  verified: boolean
}

const ERRORS: Record<string, string> = {
  email_unavailable: 'Email notifications are not switched on for this site yet.',
  invalid_email: 'That does not look like an email address.',
  signature_expired: 'The signature took too long. Try again.',
  verification_not_sent: 'The confirmation email could not be sent. Nothing was saved as verified; try again in a moment.',
  link_expired_or_used: 'This confirmation link has expired or was already used. Save your email again in settings to get a new one.',
}

export class ContactsError extends Error {
  constructor(readonly code: string) {
    super(ERRORS[code] ?? `The request was refused (${code}).`)
  }
}

type Sign = (message: string) => Promise<Hex>

async function call(path: string, init: RequestInit, fetcher: typeof fetch): Promise<Response> {
  const response = await fetcher(`${loadBrowserApiBaseUrl()}${path}`, init)
  if (!response.ok && response.status !== 404) {
    const body = (await response.json().catch(() => ({}))) as { error?: unknown }
    throw new ContactsError(typeof body.error === 'string' ? body.error : `http_${response.status}`)
  }
  return response
}

const headers = (wallet: string, signature: string, signedAt: number) => ({
  'content-type': 'application/json',
  'x-waybill-signer': wallet,
  'x-waybill-signature': signature,
  'x-waybill-signed-at': String(signedAt),
})

/** Null when this wallet has not set an email. One signature, because the address is private. */
export async function readEmailSettings(input: { wallet: string; sign: Sign; fetcher?: typeof fetch; now?: () => number }): Promise<EmailSettings | null> {
  const network = getBrowserNetwork()
  const signedAt = (input.now ?? (() => Math.floor(Date.now() / 1000)))()
  const signature = await input.sign(emailMessage({ network: network.network, chainId: network.chainId, wallet: input.wallet, action: 'read', email: '', notify: false, signedAt }))
  const response = await call('/v1/contacts', { method: 'GET', headers: headers(input.wallet, signature, signedAt) }, input.fetcher ?? fetch)
  return response.status === 404 ? null : ((await response.json()) as EmailSettings)
}

export async function saveEmailSettings(input: { wallet: string; email: string; notify: boolean; sign: Sign; fetcher?: typeof fetch; now?: () => number }): Promise<EmailSettings> {
  const network = getBrowserNetwork()
  const signedAt = (input.now ?? (() => Math.floor(Date.now() / 1000)))()
  const email = input.email.trim().toLowerCase()
  const signature = await input.sign(emailMessage({ network: network.network, chainId: network.chainId, wallet: input.wallet, action: 'set', email, notify: input.notify, signedAt }))
  const response = await call('/v1/contacts', { method: 'POST', headers: headers(input.wallet, signature, signedAt), body: JSON.stringify({ email, notify: input.notify }) }, input.fetcher ?? fetch)
  return (await response.json()) as EmailSettings
}

/** Confirms an address from the link in the email. Throws when the link is expired or used. */
export async function verifyEmailToken(token: string, fetcher: typeof fetch = fetch): Promise<void> {
  const response = await fetcher(`${loadBrowserApiBaseUrl()}/v1/contacts/verify`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) })
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: unknown }
    throw new ContactsError(typeof body.error === 'string' ? body.error : `http_${response.status}`)
  }
}
