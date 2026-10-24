import { createHash, randomBytes } from 'node:crypto'
import { verifyMessage, type Address, type Hex } from 'viem'

import type { WaybillNetwork } from '@waybill/network/networks'
import { SIGNATURE_WINDOW_SECONDS } from './evidence-auth'

interface SqlExecutor {
  query<Row>(text: string, values?: readonly unknown[]): Promise<{ rows: Row[] }>
}

export const VERIFY_LINK_HOURS = 48
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export class EmailError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code)
  }
}

export interface WalletEmail {
  email: string
  notificationsEnabled: boolean
  verified: boolean
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')

const UPSERT_SQL = `
  INSERT INTO waybill_wallet_emails (network, wallet, email, notifications_enabled, verify_token_hash, verify_expires_at)
  VALUES ($1, $2, $3, $4, $5, NOW() + make_interval(hours => $6))
  ON CONFLICT (network, wallet) DO UPDATE SET
    -- a different address starts again unverified; the same address keeps its verification
    verified_at = CASE WHEN waybill_wallet_emails.email = EXCLUDED.email THEN waybill_wallet_emails.verified_at ELSE NULL END,
    verify_token_hash = CASE WHEN waybill_wallet_emails.email = EXCLUDED.email AND waybill_wallet_emails.verified_at IS NOT NULL THEN NULL ELSE EXCLUDED.verify_token_hash END,
    verify_expires_at = CASE WHEN waybill_wallet_emails.email = EXCLUDED.email AND waybill_wallet_emails.verified_at IS NOT NULL THEN NULL ELSE EXCLUDED.verify_expires_at END,
    email = EXCLUDED.email,
    notifications_enabled = EXCLUDED.notifications_enabled,
    updated_at = NOW()
  RETURNING (verified_at IS NOT NULL) AS verified
`

const GET_SQL = `SELECT email, notifications_enabled, (verified_at IS NOT NULL) AS verified FROM waybill_wallet_emails WHERE network = $1 AND wallet = $2`

const VERIFY_SQL = `
  UPDATE waybill_wallet_emails
  SET verified_at = NOW(), verify_token_hash = NULL, verify_expires_at = NULL, updated_at = NOW()
  WHERE verify_token_hash = $1 AND verify_expires_at > NOW() AND network = $2
  RETURNING wallet
`

const RECIPIENT_SQL = `
  SELECT email FROM waybill_wallet_emails
  WHERE network = $1 AND wallet = $2 AND verified_at IS NOT NULL AND notifications_enabled
`

export class PostgresWalletEmailStore {
  constructor(private readonly database: SqlExecutor) {}

  /** Stores the address and returns the one-time token to mail, or null when the address was already verified. */
  async set(network: WaybillNetwork, wallet: string, email: string, enabled: boolean): Promise<string | null> {
    const token = randomBytes(24).toString('base64url')
    const result = await this.database.query<{ verified: boolean }>(UPSERT_SQL, [network, wallet.toLowerCase(), email, enabled, sha256(token), VERIFY_LINK_HOURS])
    return result.rows[0]?.verified ? null : token
  }

  async get(network: WaybillNetwork, wallet: string): Promise<WalletEmail | null> {
    const result = await this.database.query<{ email: string; notifications_enabled: boolean; verified: boolean }>(GET_SQL, [network, wallet.toLowerCase()])
    const row = result.rows[0]
    return row ? { email: row.email, notificationsEnabled: row.notifications_enabled, verified: row.verified } : null
  }

  /** Marks the address verified for whoever holds a valid, unexpired token. Returns the wallet, or null. */
  async verify(network: WaybillNetwork, token: string): Promise<string | null> {
    const result = await this.database.query<{ wallet: string }>(VERIFY_SQL, [sha256(token), network])
    return result.rows[0]?.wallet ?? null
  }

  /** The address to mail for this wallet: verified and not switched off. Null otherwise. */
  async recipient(network: WaybillNetwork, wallet: string): Promise<string | null> {
    const result = await this.database.query<{ email: string }>(RECIPIENT_SQL, [network, wallet.toLowerCase()])
    return result.rows[0]?.email ?? null
  }
}

export interface EmailContext {
  network: string
  chainId: number
}

/** The exact text a wallet signs to set or read its email settings. */
export function emailMessage(context: EmailContext, wallet: string, action: 'set' | 'read', email: string, notify: boolean, signedAt: number): string {
  return [
    'Waybill email settings',
    `action: ${action}`,
    `network: ${context.network}`,
    `chain: ${context.chainId}`,
    `wallet: ${wallet.toLowerCase()}`,
    `email: ${action === 'set' ? email.toLowerCase() : '-'}`,
    `notify: ${action === 'set' ? (notify ? 'yes' : 'no') : '-'}`,
    `signed: ${signedAt}`,
  ].join('\n')
}

export interface SignedEmailRequest {
  wallet: string
  signature: string
  signedAt: number
}

export interface WalletEmailServiceOptions {
  context: EmailContext
  store: Pick<PostgresWalletEmailStore, 'set' | 'get' | 'verify'>
  network: WaybillNetwork
  /** Sends the verification mail; the link is built here from the one-time token. */
  sendVerification(to: string, token: string): Promise<void>
  now?: () => number
}

/** A wallet proves it owns itself by signing; only then can it set, read or switch off its own email. */
export class WalletEmailService {
  constructor(private readonly options: WalletEmailServiceOptions) {}

  private async authorize(request: SignedEmailRequest, action: 'set' | 'read', email: string, notify: boolean): Promise<void> {
    if (!/^0x[0-9a-fA-F]{40}$/.test(request.wallet)) throw new EmailError('invalid_wallet', 401)
    if (!/^0x[0-9a-fA-F]+$/.test(request.signature)) throw new EmailError('invalid_signature', 401)
    const now = (this.options.now ?? (() => Math.floor(Date.now() / 1000)))()
    if (!Number.isInteger(request.signedAt) || Math.abs(now - request.signedAt) > SIGNATURE_WINDOW_SECONDS) throw new EmailError('signature_expired', 401)
    let valid = false
    try {
      valid = await verifyMessage({
        address: request.wallet as Address,
        message: emailMessage(this.options.context, request.wallet, action, email, notify, request.signedAt),
        signature: request.signature as Hex,
      })
    } catch {
      valid = false
    }
    if (!valid) throw new EmailError('signature_mismatch', 401)
  }

  async set(request: SignedEmailRequest, email: string, notify: boolean): Promise<WalletEmail> {
    if (typeof email !== 'string' || email.length > 254 || !EMAIL.test(email.trim())) throw new EmailError('invalid_email', 400)
    const address = email.trim().toLowerCase()
    await this.authorize(request, 'set', address, notify)
    const token = await this.options.store.set(this.options.network, request.wallet, address, notify)
    if (token !== null) {
      try {
        await this.options.sendVerification(address, token)
      } catch {
        throw new EmailError('verification_not_sent', 503)
      }
    }
    return { email: address, notificationsEnabled: notify, verified: token === null }
  }

  async read(request: SignedEmailRequest): Promise<WalletEmail | null> {
    await this.authorize(request, 'read', '', false)
    return this.options.store.get(this.options.network, request.wallet)
  }

  /** The link in the email carries the token; whoever opens it proves they can read that inbox. */
  async verify(token: string): Promise<boolean> {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{20,64}$/.test(token)) throw new EmailError('invalid_token', 400)
    return (await this.options.store.verify(this.options.network, token)) !== null
  }
}
