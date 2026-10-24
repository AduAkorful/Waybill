import type { RelayerOperation } from './config'

export const RELAYER_ATTEMPT_STATUSES = [
  'pending',
  'submitted',
  'success',
  'reverted',
] as const
export type RelayerAttemptStatus = (typeof RELAYER_ATTEMPT_STATUSES)[number]

export interface RelayerAttemptKey {
  operation: RelayerOperation
  dealId: bigint
  milestoneIndex: number
}

export interface RelayerAttempt extends RelayerAttemptKey {
  status: RelayerAttemptStatus
  txHash: `0x${string}` | null
  attemptCount: number
}

export interface AttemptReservation {
  attempt: RelayerAttempt
  shouldSubmit: boolean
}

export interface RelayerAttemptStore {
  reserve(key: RelayerAttemptKey): Promise<AttemptReservation>
  markSubmitted(key: RelayerAttemptKey, txHash: `0x${string}`): Promise<void>
  markReceipt(key: RelayerAttemptKey, status: 'success' | 'reverted'): Promise<void>
}

export function attemptKeyFor(candidate: {
  operation: RelayerOperation
  dealId: bigint
  milestoneIndex: number
}): RelayerAttemptKey {
  return {
    operation: candidate.operation,
    dealId: candidate.dealId,
    milestoneIndex: candidate.milestoneIndex,
  }
}

interface AttemptRow {
  operation: RelayerOperation
  deal_id: string | number | bigint
  milestone_index: string | number | bigint
  status: RelayerAttemptStatus
  tx_hash: `0x${string}` | null
  attempt_count: number
}

interface SqlResult<Row> {
  rows: Row[]
}

interface SqlExecutor {
  query<Row>(text: string, values?: readonly unknown[]): Promise<SqlResult<Row>>
}

const SELECT_SQL = `
  SELECT operation, deal_id, milestone_index, status, tx_hash, attempt_count
  FROM waybill_relayer_attempts
  WHERE operation = $1 AND deal_id = $2 AND milestone_index = $3
`

const INSERT_SQL = `
  INSERT INTO waybill_relayer_attempts
    (operation, deal_id, milestone_index, status, attempt_count)
  VALUES ($1, $2, $3, 'pending', 1)
  ON CONFLICT (operation, deal_id, milestone_index) DO NOTHING
  RETURNING operation, deal_id, milestone_index, status, tx_hash, attempt_count
`

const RETRY_SQL = `
  UPDATE waybill_relayer_attempts
  SET status = 'pending',
      tx_hash = NULL,
      attempt_count = attempt_count + 1,
      updated_at = NOW()
  WHERE operation = $1 AND deal_id = $2 AND milestone_index = $3
    AND status = 'reverted'
  RETURNING operation, deal_id, milestone_index, status, tx_hash, attempt_count
`

const SUBMITTED_SQL = `
  UPDATE waybill_relayer_attempts
  SET status = 'submitted',
      tx_hash = $4,
      updated_at = NOW()
  WHERE operation = $1 AND deal_id = $2 AND milestone_index = $3
    AND status = 'pending'
`

const RECEIPT_SQL = `
  UPDATE waybill_relayer_attempts
  SET status = $4,
      updated_at = NOW()
  WHERE operation = $1 AND deal_id = $2 AND milestone_index = $3
`

function validateKey(key: RelayerAttemptKey): void {
  if (key.dealId < 0n) throw new Error('dealId must be non-negative')
  if (!Number.isInteger(key.milestoneIndex) || key.milestoneIndex < 0 || key.milestoneIndex > 255) {
    throw new Error('milestoneIndex must be between 0 and 255')
  }
}

function toBigInt(value: string | number | bigint, field: string): bigint {
  try {
    const result = BigInt(value)
    if (result < 0n) throw new Error()
    return result
  } catch {
    throw new Error(`Invalid ${field} returned by attempt store`)
  }
}

function toAttempt(row: AttemptRow): RelayerAttempt {
  if (!RELAYER_ATTEMPT_STATUSES.includes(row.status)) {
    throw new Error('Invalid status returned by attempt store')
  }
  return {
    operation: row.operation,
    dealId: toBigInt(row.deal_id, 'deal_id'),
    milestoneIndex: Number(row.milestone_index),
    status: row.status,
    txHash: row.tx_hash,
    attemptCount: row.attempt_count,
  }
}

export class PostgresAttemptStore implements RelayerAttemptStore {
  constructor(private readonly database: SqlExecutor) {}

  async get(key: RelayerAttemptKey): Promise<RelayerAttempt | null> {
    validateKey(key)
    const result = await this.database.query<AttemptRow>(SELECT_SQL, [
      key.operation,
      key.dealId.toString(),
      key.milestoneIndex,
    ])
    return result.rows[0] ? toAttempt(result.rows[0]) : null
  }

  async reserve(key: RelayerAttemptKey): Promise<AttemptReservation> {
    validateKey(key)
    const values = [key.operation, key.dealId.toString(), key.milestoneIndex] as const
    const inserted = await this.database.query<AttemptRow>(INSERT_SQL, values)
    if (inserted.rows[0]) {
      return { attempt: toAttempt(inserted.rows[0]), shouldSubmit: true }
    }
    const retried = await this.database.query<AttemptRow>(RETRY_SQL, values)
    if (retried.rows[0]) {
      return { attempt: toAttempt(retried.rows[0]), shouldSubmit: true }
    }
    const attempt = await this.get(key)
    if (!attempt) throw new Error('Attempt disappeared after reservation')
    return {
      attempt,
      shouldSubmit: false,
    }
  }

  async markSubmitted(key: RelayerAttemptKey, txHash: `0x${string}`): Promise<void> {
    validateKey(key)
    if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) throw new Error('Invalid transaction hash')
    await this.database.query(SUBMITTED_SQL, [
      key.operation,
      key.dealId.toString(),
      key.milestoneIndex,
      txHash,
    ])
  }

  async markReceipt(key: RelayerAttemptKey, status: 'success' | 'reverted'): Promise<void> {
    validateKey(key)
    await this.database.query(RECEIPT_SQL, [
      key.operation,
      key.dealId.toString(),
      key.milestoneIndex,
      status,
    ])
  }
}
