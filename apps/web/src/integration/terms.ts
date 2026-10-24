import type { Hex } from 'viem'
import { loadBrowserApiBaseUrl } from './api'
import { getBrowserNetwork } from './network'
import { sha256Hex } from './evidence'
import type { DealTerms } from '@/view/types'

/** One fixed key order, so the same terms always hash the same here and in the relayer. */
export function canonicalTerms(terms: DealTerms): string {
  const ordered: Record<string, unknown> = {}
  for (const key of ['goods', 'units', 'cartons', 'origin', 'destination', 'template', 'buyerName', 'supplierName', 'milestoneTitles'] as const) {
    const value = terms[key]
    if (value === undefined) continue
    ordered[key] = key === 'origin' || key === 'destination' ? { code: (value as { code: string }).code, city: (value as { city: string }).city } : value
  }
  return JSON.stringify(ordered)
}

export async function termsDigest(terms: DealTerms): Promise<string> {
  return (await sha256Hex(new TextEncoder().encode(canonicalTerms(terms)))).slice(2)
}

/** The exact text the wallet signs. Must match the relayer's termsMessage character for character. */
export function termsMessage(input: { network: string; chainId: number; escrow: string; dealId: bigint; action: 'set' | 'read'; digest: string; isPublic: boolean | null; signedAt: number }): string {
  return [
    'Waybill deal terms',
    `action: ${input.action}`,
    `network: ${input.network}`,
    `chain: ${input.chainId}`,
    `escrow: ${input.escrow.toLowerCase()}`,
    `deal: ${input.dealId}`,
    `terms: ${input.action === 'set' ? input.digest : '-'}`,
    `public: ${input.isPublic === null ? '-' : input.isPublic ? 'yes' : 'no'}`,
    `signed: ${input.signedAt}`,
  ].join('\n')
}

export interface StoredTerms {
  terms: DealTerms
  isPublic: boolean
  setBy: string
  updatedAt: number
}

const MESSAGES: Record<string, string> = {
  not_buyer: 'Only the buyer of this deal can set its details.',
  deal_locked: 'The deal is funded, so its details can no longer be changed.',
  unknown_deal: 'The relayer has not seen this deal yet. Wait a minute and try again.',
  not_a_party: 'This wallet is not named in the deal.',
  signature_expired: 'The signature took too long. Try again.',
  terms_unavailable: 'Deal details are not available right now.',
  empty_terms: 'Fill in at least one detail.',
}

export class TermsRequestError extends Error {
  constructor(readonly code: string) {
    super(MESSAGES[code] ?? (code.startsWith('invalid_') ? `One of the details is not valid (${code.slice(8).replace(/_/g, ' ')}).` : `The request was refused (${code}).`))
  }
}

type Sign = (message: string) => Promise<Hex>

async function fail(response: Response): Promise<never> {
  const body = (await response.json().catch(() => ({}))) as { error?: unknown }
  throw new TermsRequestError(typeof body.error === 'string' ? body.error : `http_${response.status}`)
}

const headers = (signer: string, signature: string, signedAt: number) => ({ 'content-type': 'application/json', 'x-waybill-signer': signer, 'x-waybill-signature': signature, 'x-waybill-signed-at': String(signedAt) })

/** The buyer stores the details with one signature that covers exactly these terms and the public flag. */
export async function saveTerms(input: { dealId: bigint; signer: string; terms: DealTerms; isPublic: boolean; sign: Sign; fetcher?: typeof fetch; now?: () => number }): Promise<StoredTerms> {
  const network = getBrowserNetwork()
  const signedAt = (input.now ?? (() => Math.floor(Date.now() / 1000)))()
  const signature = await input.sign(
    termsMessage({ network: network.network, chainId: network.chainId, escrow: network.contracts.escrow, dealId: input.dealId, action: 'set', digest: await termsDigest(input.terms), isPublic: input.isPublic, signedAt }),
  )
  const response = await (input.fetcher ?? fetch)(`${loadBrowserApiBaseUrl()}/v1/deals/${input.dealId}/terms`, {
    method: 'POST',
    headers: headers(input.signer, signature, signedAt),
    body: JSON.stringify({ terms: input.terms, public: input.isPublic }),
  })
  return response.ok ? ((await response.json()) as StoredTerms) : fail(response)
}

/** Public details, with no signature. Null when none are set or they are private (the relayer answers 200 either way). */
export async function readPublicTerms(dealId: bigint, fetcher: typeof fetch = fetch): Promise<StoredTerms | null> {
  const response = await fetcher(`${loadBrowserApiBaseUrl()}/v1/deals/${dealId}/terms?public=1`)
  if (!response.ok) return fail(response)
  return ((await response.json()) as { terms: StoredTerms | null }).terms
}

/** Private details, readable by a party of the deal with one signature. Null when none are set. */
export async function readTermsSigned(input: { dealId: bigint; signer: string; sign: Sign; fetcher?: typeof fetch; now?: () => number }): Promise<StoredTerms | null> {
  const network = getBrowserNetwork()
  const signedAt = (input.now ?? (() => Math.floor(Date.now() / 1000)))()
  const signature = await input.sign(
    termsMessage({ network: network.network, chainId: network.chainId, escrow: network.contracts.escrow, dealId: input.dealId, action: 'read', digest: '-', isPublic: null, signedAt }),
  )
  const response = await (input.fetcher ?? fetch)(`${loadBrowserApiBaseUrl()}/v1/deals/${input.dealId}/terms`, { headers: headers(input.signer, signature, signedAt) })
  if (response.status === 404) return null
  return response.ok ? ((await response.json()) as StoredTerms) : fail(response)
}
