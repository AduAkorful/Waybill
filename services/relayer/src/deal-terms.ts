import { createHash } from 'node:crypto'
import { verifyMessage, type Address, type Hex } from 'viem'

import type { WaybillNetwork } from '@waybill/network/networks'
import { SIGNATURE_WINDOW_SECONDS } from './evidence-auth'

export class TermsError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code)
  }
}

export interface Place {
  code: string
  city: string
}

/** Details that live off-chain. Every field is optional; at least one is required. */
export interface DealTerms {
  goods?: string
  units?: number
  cartons?: number
  origin?: Place
  destination?: Place
  template?: string
  buyerName?: string
  supplierName?: string
  milestoneTitles?: string[]
}

// no control characters in anything that will be shown to other people
const PLAIN = /^[^\u0000-\u001f\u007f]*$/
const text = (value: unknown, max: number, what: string): string => {
  if (typeof value !== 'string' || value.trim() === '' || value.length > max || !PLAIN.test(value)) throw new TermsError(`invalid_${what}`, 400)
  return value.trim()
}
const count = (value: unknown, what: string): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 1_000_000_000) throw new TermsError(`invalid_${what}`, 400)
  return value as number
}
const place = (value: unknown, what: string): Place => {
  if (!value || typeof value !== 'object') throw new TermsError(`invalid_${what}`, 400)
  const v = value as Record<string, unknown>
  if (typeof v.code !== 'string' || !/^[A-Z]{2,3}$/.test(v.code)) throw new TermsError(`invalid_${what}`, 400)
  return { code: v.code, city: text(v.city, 80, what) }
}

/** Checks and normalizes terms. Unknown fields are dropped so nothing unreviewed is stored. */
export function parseTerms(raw: unknown): DealTerms {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TermsError('invalid_terms', 400)
  const r = raw as Record<string, unknown>
  const terms: DealTerms = {}
  if (r.goods !== undefined) terms.goods = text(r.goods, 300, 'goods')
  if (r.units !== undefined) terms.units = count(r.units, 'units')
  if (r.cartons !== undefined) terms.cartons = count(r.cartons, 'cartons')
  if (r.origin !== undefined) terms.origin = place(r.origin, 'origin')
  if (r.destination !== undefined) terms.destination = place(r.destination, 'destination')
  if (r.template !== undefined) terms.template = text(r.template, 80, 'template')
  if (r.buyerName !== undefined) terms.buyerName = text(r.buyerName, 120, 'buyer_name')
  if (r.supplierName !== undefined) terms.supplierName = text(r.supplierName, 120, 'supplier_name')
  if (r.milestoneTitles !== undefined) {
    if (!Array.isArray(r.milestoneTitles) || r.milestoneTitles.length > 8) throw new TermsError('invalid_titles', 400)
    terms.milestoneTitles = r.milestoneTitles.map((t) => (typeof t === 'string' && t.trim() === '' ? '' : text(t, 80, 'titles')))
  }
  if (Object.keys(terms).length === 0) throw new TermsError('empty_terms', 400)
  return terms
}

/** One fixed key order, so the same terms always hash the same in the browser and here. */
export function canonicalTerms(terms: DealTerms): string {
  const ordered: Record<string, unknown> = {}
  for (const key of ['goods', 'units', 'cartons', 'origin', 'destination', 'template', 'buyerName', 'supplierName', 'milestoneTitles'] as const) {
    const value = terms[key]
    if (value === undefined) continue
    ordered[key] = key === 'origin' || key === 'destination' ? { code: (value as Place).code, city: (value as Place).city } : value
  }
  return JSON.stringify(ordered)
}

export const termsDigest = (terms: DealTerms): string => createHash('sha256').update(canonicalTerms(terms)).digest('hex')

export interface TermsContext {
  network: string
  chainId: number
  escrow: Address
  dealId: bigint
}

/** The exact text a wallet signs to set or read a deal's terms. It binds the deal and the digest of the terms. */
export function termsMessage(context: TermsContext, action: 'set' | 'read', digest: string, isPublic: boolean | null, signedAt: number): string {
  return [
    'Waybill deal terms',
    `action: ${action}`,
    `network: ${context.network}`,
    `chain: ${context.chainId}`,
    `escrow: ${context.escrow.toLowerCase()}`,
    `deal: ${context.dealId}`,
    `terms: ${action === 'set' ? digest : '-'}`,
    `public: ${isPublic === null ? '-' : isPublic ? 'yes' : 'no'}`,
    `signed: ${signedAt}`,
  ].join('\n')
}

export interface StoredTerms {
  terms: DealTerms
  isPublic: boolean
  setBy: string
  updatedAt: number
}

export interface TermsStore {
  upsert(network: WaybillNetwork, dealId: bigint, terms: DealTerms, isPublic: boolean, setBy: string): Promise<void>
  get(network: WaybillNetwork, dealId: bigint): Promise<StoredTerms | null>
}

interface SqlExecutor {
  query<Row>(text: string, values?: readonly unknown[]): Promise<{ rows: Row[] }>
}

export class PostgresTermsStore implements TermsStore {
  constructor(private readonly database: SqlExecutor) {}

  async upsert(network: WaybillNetwork, dealId: bigint, terms: DealTerms, isPublic: boolean, setBy: string): Promise<void> {
    await this.database.query(
      `INSERT INTO waybill_deal_terms (network, deal_id, terms, is_public, set_by) VALUES ($1, $2, $3::jsonb, $4, lower($5))
       ON CONFLICT (network, deal_id) DO UPDATE SET terms = EXCLUDED.terms, is_public = EXCLUDED.is_public, set_by = EXCLUDED.set_by, updated_at = NOW()`,
      [network, dealId.toString(), JSON.stringify(terms), isPublic, setBy],
    )
  }

  async get(network: WaybillNetwork, dealId: bigint): Promise<StoredTerms | null> {
    const result = await this.database.query<{ terms: DealTerms; is_public: boolean; set_by: string; updated: string }>(
      `SELECT terms, is_public, set_by, EXTRACT(EPOCH FROM updated_at)::bigint::text AS updated FROM waybill_deal_terms WHERE network = $1 AND deal_id = $2`,
      [network, dealId.toString()],
    )
    const row = result.rows[0]
    return row ? { terms: row.terms, isPublic: row.is_public, setBy: row.set_by, updatedAt: Number(row.updated) } : null
  }
}

export interface SignedTerms {
  signer: string
  signature: string
  signedAt: number
}

export interface TermsServiceOptions {
  context: (dealId: bigint) => TermsContext
  network: WaybillNetwork
  store: TermsStore
  isBuyer(dealId: bigint, address: string): Promise<boolean>
  isParty(dealId: bigint, address: string): Promise<boolean>
  /** The indexed state word of the deal (CREATED, FUNDED, ...), or null when the deal is not indexed */
  dealState(dealId: bigint): Promise<string | null>
  now?: () => number
}

/** The buyer records goods, names and places while the deal is unfunded; parties read them, and anyone can read public ones. */
export class DealTermsService {
  constructor(private readonly options: TermsServiceOptions) {}

  private async verify(dealId: bigint, action: 'set' | 'read', digest: string, isPublic: boolean | null, signed: SignedTerms): Promise<Address> {
    if (!/^0x[0-9a-fA-F]{40}$/.test(signed.signer)) throw new TermsError('invalid_signer', 401)
    if (!/^0x[0-9a-fA-F]+$/.test(signed.signature)) throw new TermsError('invalid_signature', 401)
    const now = (this.options.now ?? (() => Math.floor(Date.now() / 1000)))()
    if (!Number.isInteger(signed.signedAt) || Math.abs(now - signed.signedAt) > SIGNATURE_WINDOW_SECONDS) throw new TermsError('signature_expired', 401)
    let valid = false
    try {
      valid = await verifyMessage({
        address: signed.signer as Address,
        message: termsMessage(this.options.context(dealId), action, digest, isPublic, signed.signedAt),
        signature: signed.signature as Hex,
      })
    } catch {
      valid = false
    }
    if (!valid) throw new TermsError('signature_mismatch', 401)
    return signed.signer as Address
  }

  async set(dealId: bigint, raw: unknown, isPublic: boolean, signed: SignedTerms): Promise<StoredTerms> {
    const terms = parseTerms(raw)
    const signer = await this.verify(dealId, 'set', termsDigest(terms), isPublic, signed)
    if (!(await this.options.isBuyer(dealId, signer))) throw new TermsError('not_buyer', 403)
    const state = await this.options.dealState(dealId)
    if (state === null) throw new TermsError('unknown_deal', 404)
    // once the money is locked the terms are what the others agreed to; they are not edited afterwards
    if (state !== 'CREATED') throw new TermsError('deal_locked', 409)
    await this.options.store.upsert(this.options.network, dealId, terms, isPublic, signer)
    return (await this.options.store.get(this.options.network, dealId))!
  }

  /** Only terms the buyer made public. Never throws for private or missing ones: the answer is just null. */
  async readPublic(dealId: bigint): Promise<StoredTerms | null> {
    const stored = await this.options.store.get(this.options.network, dealId)
    return stored?.isPublic ? stored : null
  }

  /** Public terms need no signature. Private ones need a signature from a party of the deal. Null when none are set. */
  async read(dealId: bigint, signed: SignedTerms | null): Promise<StoredTerms | null> {
    const stored = await this.options.store.get(this.options.network, dealId)
    if (!stored) return null
    if (stored.isPublic) return stored
    if (!signed) throw new TermsError('missing_signature', 401)
    const signer = await this.verify(dealId, 'read', '-', null, signed)
    if (!(await this.options.isParty(dealId, signer))) throw new TermsError('not_a_party', 403)
    return stored
  }
}
