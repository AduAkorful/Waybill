import type { WaybillNetwork } from '../../../config/networks'

export const NOTIFICATION_CHANNELS = ['email'] as const
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number]
export const NOTIFICATION_STATUSES = ['pending', 'processing', 'sent', 'failed'] as const
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number]

export interface NotificationInput {
  network: WaybillNetwork
  dedupeKey: string
  channel: NotificationChannel
  recipient: string
  template: string
  payload: Record<string, unknown>
}

export interface NotificationMessage extends NotificationInput {
  id: number
  status: NotificationStatus
  attempts: number
  lastError: string | null
}

interface NotificationRow {
  id: number
  network: WaybillNetwork
  dedupe_key: string
  channel: NotificationChannel
  recipient: string
  template: string
  payload: Record<string, unknown>
  status: NotificationStatus
  attempts: number
  last_error: string | null
}

interface SqlResult<Row> {
  rows: Row[]
}

interface SqlExecutor {
  query<Row>(text: string, values?: readonly unknown[]): Promise<SqlResult<Row>>
}

const ENQUEUE_SQL = `
  INSERT INTO waybill_notification_outbox
    (network, dedupe_key, channel, recipient, template, payload, status)
  VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'pending')
  ON CONFLICT (network, dedupe_key) DO UPDATE
    SET dedupe_key = EXCLUDED.dedupe_key
  RETURNING id, network, dedupe_key, channel, recipient, template,
            payload, status, attempts, last_error
`

const CLAIM_SQL = `
  WITH candidates AS (
    SELECT id
    FROM waybill_notification_outbox
    WHERE available_at <= NOW()
      AND (
        status IN ('pending', 'failed')
        OR (status = 'processing' AND lease_until < NOW())
      )
    ORDER BY id
    FOR UPDATE SKIP LOCKED
    LIMIT $1
  )
  UPDATE waybill_notification_outbox AS outbox
  SET status = 'processing',
      lease_until = NOW() + make_interval(secs => $2),
      attempts = attempts + 1,
      updated_at = NOW()
  FROM candidates
  WHERE outbox.id = candidates.id
  RETURNING outbox.id, outbox.network, outbox.dedupe_key,
            outbox.channel, outbox.recipient, outbox.template,
            outbox.payload, outbox.status, outbox.attempts, outbox.last_error
`

const SENT_SQL = `
  UPDATE waybill_notification_outbox
  SET status = 'sent', lease_until = NULL, updated_at = NOW()
  WHERE id = $1 AND status = 'processing'
`

const FAILED_SQL = `
  UPDATE waybill_notification_outbox
  SET status = 'failed',
      lease_until = NULL,
      available_at = NOW() + make_interval(secs => $2),
      last_error = $3,
      updated_at = NOW()
  WHERE id = $1 AND status = 'processing'
`

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+$/

function validateInput(input: NotificationInput): void {
  if (!input.dedupeKey.trim()) throw new Error('Notification dedupe key cannot be empty')
  if (!EMAIL_PATTERN.test(input.recipient)) throw new Error('Invalid notification recipient')
  if (!input.template.trim()) throw new Error('Notification template cannot be empty')
  if (!NOTIFICATION_CHANNELS.includes(input.channel)) {
    throw new Error('Unsupported notification channel')
  }
  JSON.stringify(input.payload)
}

function toMessage(row: NotificationRow): NotificationMessage {
  if (!NOTIFICATION_STATUSES.includes(row.status)) {
    throw new Error('Invalid notification status returned by outbox')
  }
  return {
    network: row.network,
    dedupeKey: row.dedupe_key,
    channel: row.channel,
    recipient: row.recipient,
    template: row.template,
    payload: row.payload,
    id: row.id,
    status: row.status,
    attempts: row.attempts,
    lastError: row.last_error,
  }
}

export class PostgresNotificationOutbox {
  constructor(private readonly database: SqlExecutor) {}

  async enqueue(input: NotificationInput): Promise<NotificationMessage> {
    validateInput(input)
    const result = await this.database.query<NotificationRow>(ENQUEUE_SQL, [
      input.network,
      input.dedupeKey,
      input.channel,
      input.recipient,
      input.template,
      JSON.stringify(input.payload),
    ])
    const row = result.rows[0]
    if (!row) throw new Error('Notification enqueue returned no row')
    return toMessage(row)
  }

  async claimBatch(limit: number, leaseSeconds: number): Promise<NotificationMessage[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new Error('Notification batch limit must be between 1 and 100')
    }
    if (!Number.isSafeInteger(leaseSeconds) || leaseSeconds < 1 || leaseSeconds > 3_600) {
      throw new Error('Notification lease must be between 1 and 3600 seconds')
    }
    const result = await this.database.query<NotificationRow>(CLAIM_SQL, [limit, leaseSeconds])
    return result.rows.map(toMessage)
  }

  async markSent(id: number): Promise<void> {
    if (!Number.isSafeInteger(id) || id < 1) throw new Error('Invalid notification id')
    await this.database.query(SENT_SQL, [id])
  }

  async markFailed(id: number, retryAfterSeconds: number, error: string): Promise<void> {
    if (!Number.isSafeInteger(id) || id < 1) throw new Error('Invalid notification id')
    if (!Number.isSafeInteger(retryAfterSeconds) || retryAfterSeconds < 1 || retryAfterSeconds > 86_400) {
      throw new Error('Notification retry delay must be between 1 and 86400 seconds')
    }
    if (!error.trim()) throw new Error('Notification failure cannot be empty')
    await this.database.query(FAILED_SQL, [id, retryAfterSeconds, error.slice(0, 2_000)])
  }
}
