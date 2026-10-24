import type { WaybillNetwork } from '../../../config/networks'

export interface ChainEventRecord {
  network: WaybillNetwork
  blockNumber: bigint
  logIndex: bigint
  transactionHash: `0x${string}`
  eventName: string
  dealId?: bigint
  milestoneIndex?: number
  payload: Record<string, unknown>
}

export interface DealProjection {
  network: WaybillNetwork
  dealId: bigint
  state: string
  buyer?: `0x${string}`
  supplier?: `0x${string}`
  supplierPayout?: `0x${string}`
  totalAmount?: bigint
  prepaidFee?: bigint
  lastBlockNumber: bigint
  lastLogIndex: bigint
}

interface SqlResult<Row> {
  rows: Row[]
}

interface SqlExecutor {
  query<Row>(text: string, values?: readonly unknown[]): Promise<SqlResult<Row>>
}

const EVENT_INSERT_SQL = `
  INSERT INTO waybill_chain_events
    (network, block_number, log_index, transaction_hash, event_name,
     deal_id, milestone_index, payload)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
  ON CONFLICT (network, block_number, log_index) DO NOTHING
  RETURNING block_number
`

const DEAL_UPSERT_SQL = `
  INSERT INTO waybill_deal_projections
    (network, deal_id, state, buyer, supplier, supplier_payout,
     total_amount, prepaid_fee, last_block_number, last_log_index)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
  ON CONFLICT (network, deal_id) DO UPDATE
    SET state = EXCLUDED.state,
        buyer = COALESCE(EXCLUDED.buyer, waybill_deal_projections.buyer),
        supplier = COALESCE(EXCLUDED.supplier, waybill_deal_projections.supplier),
        supplier_payout = COALESCE(EXCLUDED.supplier_payout, waybill_deal_projections.supplier_payout),
        total_amount = COALESCE(EXCLUDED.total_amount, waybill_deal_projections.total_amount),
        prepaid_fee = COALESCE(EXCLUDED.prepaid_fee, waybill_deal_projections.prepaid_fee),
        last_block_number = EXCLUDED.last_block_number,
        last_log_index = EXCLUDED.last_log_index,
        updated_at = NOW()
    WHERE waybill_deal_projections.last_block_number < EXCLUDED.last_block_number
       OR (
         waybill_deal_projections.last_block_number = EXCLUDED.last_block_number
         AND waybill_deal_projections.last_log_index < EXCLUDED.last_log_index
       )
`

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/
const HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/

function validatePosition(blockNumber: bigint, logIndex: bigint): void {
  if (blockNumber < 0n || logIndex < 0n) throw new Error('Chain position must be non-negative')
}

function validateAddress(value: string | undefined, field: string): void {
  if (value !== undefined && !ADDRESS_PATTERN.test(value)) {
    throw new Error(`Invalid ${field}`)
  }
}

function validateAmount(value: bigint | undefined, field: string): void {
  if (value !== undefined && value < 0n) throw new Error(`${field} must be non-negative`)
}

function validateEvent(event: ChainEventRecord): void {
  validatePosition(event.blockNumber, event.logIndex)
  if (!HASH_PATTERN.test(event.transactionHash)) throw new Error('Invalid transaction hash')
  if (!event.eventName.trim()) throw new Error('Event name cannot be empty')
  if (event.dealId !== undefined && event.dealId < 0n) throw new Error('dealId must be non-negative')
  if (
    event.milestoneIndex !== undefined &&
    (!Number.isInteger(event.milestoneIndex) || event.milestoneIndex < 0 || event.milestoneIndex > 255)
  ) {
    throw new Error('milestoneIndex must be between 0 and 255')
  }
}

function validateProjection(projection: DealProjection): void {
  if (projection.dealId < 0n) throw new Error('dealId must be non-negative')
  if (!projection.state.trim()) throw new Error('Deal state cannot be empty')
  validateAddress(projection.buyer, 'buyer')
  validateAddress(projection.supplier, 'supplier')
  validateAddress(projection.supplierPayout, 'supplierPayout')
  validateAmount(projection.totalAmount, 'totalAmount')
  validateAmount(projection.prepaidFee, 'prepaidFee')
  validatePosition(projection.lastBlockNumber, projection.lastLogIndex)
}

export class PostgresReadModelStore {
  constructor(private readonly database: SqlExecutor) {}

  async recordEvent(event: ChainEventRecord): Promise<boolean> {
    validateEvent(event)
    const result = await this.database.query(EVENT_INSERT_SQL, [
      event.network,
      event.blockNumber.toString(),
      event.logIndex.toString(),
      event.transactionHash,
      event.eventName,
      event.dealId?.toString() ?? null,
      event.milestoneIndex ?? null,
      JSON.stringify(event.payload),
    ])
    return result.rows.length > 0
  }

  async upsertDeal(projection: DealProjection): Promise<void> {
    validateProjection(projection)
    await this.database.query(DEAL_UPSERT_SQL, [
      projection.network,
      projection.dealId.toString(),
      projection.state,
      projection.buyer ?? null,
      projection.supplier ?? null,
      projection.supplierPayout ?? null,
      projection.totalAmount?.toString() ?? null,
      projection.prepaidFee?.toString() ?? null,
      projection.lastBlockNumber.toString(),
      projection.lastLogIndex.toString(),
    ])
  }
}
