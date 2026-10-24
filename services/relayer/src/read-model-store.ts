import type { WaybillNetwork } from '@waybill/network/networks'

export interface ChainEventRecord {
  network: WaybillNetwork
  blockNumber: bigint
  logIndex: bigint
  transactionHash: `0x${string}`
  eventName: string
  dealId?: bigint
  milestoneIndex?: number
  /** Unix seconds of the emitting block, when the indexer could read it */
  blockTimestamp?: bigint
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

interface DealProjectionRow {
  network: WaybillNetwork
  deal_id: string | number | bigint
  state: string
  buyer: `0x${string}` | null
  supplier: `0x${string}` | null
  supplier_payout: `0x${string}` | null
  total_amount: string | number | bigint | null
  prepaid_fee: string | number | bigint | null
  last_block_number: string | number | bigint
  last_log_index: string | number | bigint
}

const EVENT_INSERT_SQL = `
  INSERT INTO waybill_chain_events
    (network, block_number, log_index, transaction_hash, event_name,
     deal_id, milestone_index, payload, block_timestamp)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
  ON CONFLICT (network, block_number, log_index) DO NOTHING
  RETURNING block_number
`

const DEAL_EVENTS_SQL = `
  SELECT block_number, log_index, transaction_hash, event_name, milestone_index,
         block_timestamp, payload
  FROM waybill_chain_events
  WHERE network = $1 AND deal_id = $2
  ORDER BY block_number ASC, log_index ASC
`

const ATTESTOR_ADDRESSES_SQL = `
  SELECT DISTINCT ON (lower(payload->>'attestor')) payload->>'attestor' AS attestor
  FROM waybill_chain_events
  WHERE network = $1 AND event_name = ANY($2::text[]) AND payload ? 'attestor'
  ORDER BY lower(payload->>'attestor')
`

const ARBITER_ADDRESSES_SQL = `
  SELECT DISTINCT ON (lower(payload->>'arbiter')) payload->>'arbiter' AS arbiter
  FROM waybill_chain_events
  WHERE network = $1 AND event_name = ANY($2::text[]) AND payload ? 'arbiter'
  ORDER BY lower(payload->>'arbiter')
`

const ATTESTOR_EVENTS_SQL = `
  SELECT block_number, log_index, transaction_hash, event_name, milestone_index,
         block_timestamp, payload
  FROM waybill_chain_events
  WHERE network = $1 AND event_name = ANY($2::text[]) AND lower(payload->>'attestor') = lower($3)
  ORDER BY block_number ASC, log_index ASC
`

const PARTY_INSERT_SQL = `
  INSERT INTO waybill_deal_parties (network, deal_id, address, role, milestone_index)
  VALUES ($1, $2, lower($3), $4, $5)
  ON CONFLICT DO NOTHING
`

const WALLET_DEALS_SQL = `
  SELECT p.deal_id, p.role, p.milestone_index, d.state
  FROM waybill_deal_parties p
  LEFT JOIN waybill_deal_projections d ON d.network = p.network AND d.deal_id = p.deal_id
  WHERE p.network = $1 AND p.address = lower($2)
  ORDER BY p.deal_id DESC, p.role ASC, p.milestone_index ASC
`

const DEAL_PARTIES_SQL = `
  SELECT address, role, milestone_index FROM waybill_deal_parties WHERE network = $1 AND deal_id = $2
`

const IS_PARTY_SQL = `
  SELECT 1 FROM waybill_deal_parties WHERE network = $1 AND deal_id = $2 AND address = lower($3) LIMIT 1
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

const DEAL_GET_SQL = `
  SELECT network, deal_id, state, buyer, supplier, supplier_payout,
         total_amount, prepaid_fee, last_block_number, last_log_index
  FROM waybill_deal_projections
  WHERE network = $1 AND deal_id = $2
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
  if (event.blockTimestamp !== undefined && event.blockTimestamp < 0n) {
    throw new Error('blockTimestamp must be non-negative')
  }
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

function toProjection(row: DealProjectionRow): DealProjection {
  const dealId = BigInt(row.deal_id)
  const lastBlockNumber = BigInt(row.last_block_number)
  const lastLogIndex = BigInt(row.last_log_index)
  if (dealId < 0n || lastBlockNumber < 0n || lastLogIndex < 0n) {
    throw new Error('Invalid deal projection position returned by store')
  }
  return {
    network: row.network,
    dealId,
    state: row.state,
    buyer: row.buyer ?? undefined,
    supplier: row.supplier ?? undefined,
    supplierPayout: row.supplier_payout ?? undefined,
    totalAmount: row.total_amount === null ? undefined : BigInt(row.total_amount),
    prepaidFee: row.prepaid_fee === null ? undefined : BigInt(row.prepaid_fee),
    lastBlockNumber,
    lastLogIndex,
  }
}

export interface DealEvent {
  blockNumber: bigint
  logIndex: bigint
  transactionHash: `0x${string}`
  eventName: string
  milestoneIndex: number | null
  /** Unix seconds; null when the indexer did not record it */
  blockTimestamp: bigint | null
  payload: Record<string, unknown>
}

interface DealEventRow {
  block_number: string | number | bigint
  log_index: string | number | bigint
  transaction_hash: `0x${string}`
  event_name: string
  milestone_index: number | null
  block_timestamp: string | number | bigint | null
  payload: Record<string, unknown>
}

function toDealEvent(row: DealEventRow): DealEvent {
  return {
    blockNumber: BigInt(row.block_number),
    logIndex: BigInt(row.log_index),
    transactionHash: row.transaction_hash,
    eventName: row.event_name,
    milestoneIndex: row.milestone_index,
    blockTimestamp: row.block_timestamp === null ? null : BigInt(row.block_timestamp),
    payload: row.payload,
  }
}

export interface WalletDeal {
  dealId: bigint
  /** The indexed state of the deal, or null before the projection has one */
  state: string | null
  roles: { role: string; milestoneIndex: number | null }[]
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
      event.blockTimestamp?.toString() ?? null,
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

  async getDeal(network: WaybillNetwork, dealId: bigint): Promise<DealProjection | null> {
    if (dealId < 0n) throw new Error('dealId must be non-negative')
    const result = await this.database.query<DealProjectionRow>(DEAL_GET_SQL, [
      network,
      dealId.toString(),
    ])
    return result.rows[0] ? toProjection(result.rows[0]) : null
  }

  /** Every indexed event for one deal, oldest first. */
  async getDealEvents(network: WaybillNetwork, dealId: bigint): Promise<DealEvent[]> {
    if (dealId < 0n) throw new Error('dealId must be non-negative')
    const result = await this.database.query<DealEventRow>(DEAL_EVENTS_SQL, [
      network,
      dealId.toString(),
    ])
    return result.rows.map(toDealEvent)
  }

  /** Every address with a presence in the attestor registry's indexed events. */
  async listAttestorAddresses(network: WaybillNetwork, eventNames: readonly string[]): Promise<`0x${string}`[]> {
    const result = await this.database.query<{ attestor: `0x${string}` }>(ATTESTOR_ADDRESSES_SQL, [network, eventNames])
    return result.rows.map((row) => row.attestor)
  }

  /** Every arbiter address that has an event on the arbiter list. */
  async listArbiterAddresses(network: WaybillNetwork, eventNames: readonly string[]): Promise<`0x${string}`[]> {
    const result = await this.database.query<{ arbiter: `0x${string}` }>(ARBITER_ADDRESSES_SQL, [network, eventNames])
    return result.rows.map((row) => row.arbiter)
  }

  /** The registry events for one attestor, oldest first. */
  async getAttestorEvents(network: WaybillNetwork, address: string, eventNames: readonly string[]): Promise<DealEvent[]> {
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error('Invalid attestor address')
    const result = await this.database.query<DealEventRow>(ATTESTOR_EVENTS_SQL, [network, eventNames, address])
    return result.rows.map(toDealEvent)
  }

  /** Records who is named in a deal. Safe to repeat. */
  async recordParties(
    network: WaybillNetwork,
    dealId: bigint,
    parties: readonly { address: string; role: string; milestoneIndex: number | null }[],
  ): Promise<void> {
    if (dealId < 0n) throw new Error('dealId must be non-negative')
    for (const party of parties) {
      if (!/^0x[0-9a-fA-F]{40}$/.test(party.address)) throw new Error('Invalid party address')
      await this.database.query(PARTY_INSERT_SQL, [
        network,
        dealId.toString(),
        party.address,
        party.role,
        party.milestoneIndex ?? -1,
      ])
    }
  }

  /** Every deal that names this wallet, newest first, with the roles it holds in each. */
  async getWalletDeals(network: WaybillNetwork, address: string): Promise<WalletDeal[]> {
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error('Invalid wallet address')
    const result = await this.database.query<{
      deal_id: string | number | bigint
      role: string
      milestone_index: number
      state: string | null
    }>(WALLET_DEALS_SQL, [network, address])
    const deals = new Map<string, WalletDeal>()
    for (const row of result.rows) {
      const key = String(row.deal_id)
      const deal = deals.get(key) ?? { dealId: BigInt(row.deal_id), state: row.state, roles: [] }
      deal.roles.push({ role: row.role, milestoneIndex: row.milestone_index === -1 ? null : row.milestone_index })
      deals.set(key, deal)
    }
    return [...deals.values()]
  }

  /** Everyone the escrow names in a deal, as indexed when it was created. */
  async listDealParties(network: WaybillNetwork, dealId: bigint): Promise<{ address: string; role: 'buyer' | 'supplier' | 'arbiter' | 'panel' | 'attestor'; milestoneIndex: number | null }[]> {
    const result = await this.database.query<{ address: string; role: 'buyer' | 'supplier' | 'arbiter' | 'panel' | 'attestor'; milestone_index: number }>(DEAL_PARTIES_SQL, [network, dealId.toString()])
    return result.rows.map((r) => ({ address: r.address, role: r.role, milestoneIndex: r.milestone_index < 0 ? null : r.milestone_index }))
  }

  /** Whether the escrow names this wallet in the deal in any role, as indexed from the contract. */
  async isDealParty(network: WaybillNetwork, dealId: bigint, address: string): Promise<boolean> {
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error('Invalid wallet address')
    const result = await this.database.query<{ '?column?': number }>(IS_PARTY_SQL, [network, dealId.toString(), address])
    return result.rows.length > 0
  }
}
