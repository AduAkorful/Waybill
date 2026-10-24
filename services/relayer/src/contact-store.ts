import type { WaybillNetwork } from '../../../config/networks'

export const CONTACT_ROLES = ['buyer', 'supplier', 'attestor', 'arbiter', 'operator'] as const
export type ContactRole = (typeof CONTACT_ROLES)[number]

export interface ContactInput {
  network: WaybillNetwork
  wallet: `0x${string}`
  role: ContactRole
  email?: string
  notificationsEnabled: boolean
}

export interface ContactRecord extends ContactInput {}

export interface DealFlag {
  network: WaybillNetwork
  dealId: bigint
  label: string
  isTest: boolean
  notes?: string
}

interface ContactRow {
  network: WaybillNetwork
  wallet: `0x${string}`
  role: ContactRole
  email: string | null
  notifications_enabled: boolean
}

interface FlagRow {
  network: WaybillNetwork
  deal_id: string | number | bigint
  label: string
  is_test: boolean
  notes: string | null
}

interface SqlResult<Row> {
  rows: Row[]
}

interface SqlExecutor {
  query<Row>(text: string, values?: readonly unknown[]): Promise<SqlResult<Row>>
}

const CONTACT_UPSERT_SQL = `
  INSERT INTO waybill_contacts
    (network, wallet, role, email, notifications_enabled)
  VALUES ($1, $2, $3, $4, $5)
  ON CONFLICT (network, wallet, role) DO UPDATE
    SET email = EXCLUDED.email,
        notifications_enabled = EXCLUDED.notifications_enabled,
        updated_at = NOW()
  RETURNING network, wallet, role, email, notifications_enabled
`

const CONTACT_GET_SQL = `
  SELECT network, wallet, role, email, notifications_enabled
  FROM waybill_contacts
  WHERE network = $1 AND wallet = $2 AND role = $3
`

const FLAG_UPSERT_SQL = `
  INSERT INTO waybill_deal_flags (network, deal_id, label, is_test, notes)
  VALUES ($1, $2, $3, $4, $5)
  ON CONFLICT (network, deal_id) DO UPDATE
    SET label = EXCLUDED.label,
        is_test = EXCLUDED.is_test,
        notes = EXCLUDED.notes,
        updated_at = NOW()
  RETURNING network, deal_id, label, is_test, notes
`

const FLAG_GET_SQL = `
  SELECT network, deal_id, label, is_test, notes
  FROM waybill_deal_flags
  WHERE network = $1 AND deal_id = $2
`

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+$/

function validateContact(input: ContactInput): void {
  if (!ADDRESS_PATTERN.test(input.wallet)) throw new Error('Invalid contact wallet')
  if (!CONTACT_ROLES.includes(input.role)) throw new Error('Invalid contact role')
  if (input.email !== undefined && !EMAIL_PATTERN.test(input.email)) {
    throw new Error('Invalid contact email')
  }
}

function validateFlag(flag: DealFlag): void {
  if (flag.dealId < 0n) throw new Error('dealId must be non-negative')
  if (!flag.label.trim()) throw new Error('Deal flag label cannot be empty')
  if (flag.notes !== undefined && flag.notes.length > 2_000) {
    throw new Error('Deal flag notes are too long')
  }
}

function toContact(row: ContactRow): ContactRecord {
  return {
    network: row.network,
    wallet: row.wallet,
    role: row.role,
    email: row.email ?? undefined,
    notificationsEnabled: row.notifications_enabled,
  }
}

function toFlag(row: FlagRow): DealFlag {
  const dealId = BigInt(row.deal_id)
  if (dealId < 0n) throw new Error('Invalid deal_id returned by flag store')
  return {
    network: row.network,
    dealId,
    label: row.label,
    isTest: row.is_test,
    notes: row.notes ?? undefined,
  }
}

export class PostgresContactStore {
  constructor(private readonly database: SqlExecutor) {}

  async upsertContact(input: ContactInput): Promise<ContactRecord> {
    validateContact(input)
    const result = await this.database.query<ContactRow>(CONTACT_UPSERT_SQL, [
      input.network,
      input.wallet,
      input.role,
      input.email ?? null,
      input.notificationsEnabled,
    ])
    const row = result.rows[0]
    if (!row) throw new Error('Contact upsert returned no row')
    return toContact(row)
  }

  async getContact(
    network: WaybillNetwork,
    wallet: `0x${string}`,
    role: ContactRole,
  ): Promise<ContactRecord | null> {
    validateContact({ network, wallet, role, notificationsEnabled: true })
    const result = await this.database.query<ContactRow>(CONTACT_GET_SQL, [
      network,
      wallet,
      role,
    ])
    return result.rows[0] ? toContact(result.rows[0]) : null
  }

  async upsertDealFlag(flag: DealFlag): Promise<DealFlag> {
    validateFlag(flag)
    const result = await this.database.query<FlagRow>(FLAG_UPSERT_SQL, [
      flag.network,
      flag.dealId.toString(),
      flag.label,
      flag.isTest,
      flag.notes ?? null,
    ])
    const row = result.rows[0]
    if (!row) throw new Error('Deal flag upsert returned no row')
    return toFlag(row)
  }

  async getDealFlag(network: WaybillNetwork, dealId: bigint): Promise<DealFlag | null> {
    if (dealId < 0n) throw new Error('dealId must be non-negative')
    const result = await this.database.query<FlagRow>(FLAG_GET_SQL, [
      network,
      dealId.toString(),
    ])
    return result.rows[0] ? toFlag(result.rows[0]) : null
  }
}
