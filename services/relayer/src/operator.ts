import { parseAbi, type PublicClient } from 'viem'

import type { WaybillNetwork, WaybillNetworkManifest } from '@waybill/network/networks'

interface SqlExecutor {
  query<Row>(text: string, values?: readonly unknown[]): Promise<{ rows: Row[] }>
}

const DISPUTE_CLOSERS = ['DisputeWithdrawn', 'DisputeResolved', 'TrancheSplit', 'DefaultApplied', 'PanelResolved'] as const
/** Escrow-level changes an operator or the pauser can make, in the order the log shows them. */
export const ADMIN_EVENT_NAMES = [
  'NewDealsPaused',
  'NewDealsUnpaused',
  'SetTreasuryScheduled',
  'SetTreasuryExecuted',
  'SetFeeBpsRangeScheduled',
  'SetFeeBpsRangeExecuted',
  'CapsLowered',
  'CapsRaiseScheduled',
  'CapsRaised',
] as const

const STATE_SQL = `
  SELECT state, count(*)::int AS deals
  FROM waybill_deal_projections WHERE network = $1 GROUP BY state
`

const VOLUME_SQL = `
  SELECT e.event_name, f.label, f.is_test, count(*)::int AS deals,
         COALESCE(sum((e.payload->>'totalAmount')::numeric), 0)::text AS amount
  FROM waybill_chain_events e
  LEFT JOIN waybill_deal_flags f ON f.network = e.network AND f.deal_id = e.deal_id
  WHERE e.network = $1 AND e.event_name IN ('DealCreated', 'DealFunded')
  GROUP BY e.event_name, f.label, f.is_test
`

const DISPUTES_SQL = `
  SELECT count(*)::int AS open FROM (
    SELECT DISTINCT ON (deal_id, milestone_index) event_name
    FROM waybill_chain_events
    WHERE network = $1 AND milestone_index IS NOT NULL AND event_name = ANY($2::text[])
    ORDER BY deal_id, milestone_index, block_number DESC, log_index DESC
  ) latest WHERE event_name = 'DisputeRaised'
`

const CURSORS_SQL = `
  SELECT stream, block_number::text AS block_number, EXTRACT(EPOCH FROM updated_at)::bigint::text AS updated
  FROM waybill_relayer_cursors WHERE stream = ANY($1::text[]) ORDER BY stream
`

const ADMIN_LOG_SQL = `
  SELECT event_name, block_number::text AS block_number, transaction_hash, block_timestamp::text AS block_timestamp, payload
  FROM waybill_chain_events
  WHERE network = $1 AND event_name = ANY($2::text[])
  ORDER BY block_number DESC, log_index DESC LIMIT $3
`

const SET_LABELS_SQL = `
  INSERT INTO waybill_deal_flags (network, deal_id, label, is_test)
  SELECT $1, g.id, $4, $5
  FROM unnest($2::numeric[], $3::numeric[]) AS r(lo, hi), generate_series(r.lo, r.hi) AS g(id)
  ON CONFLICT (network, deal_id) DO UPDATE
    SET label = EXCLUDED.label, is_test = EXCLUDED.is_test, updated_at = NOW()
  RETURNING deal_id
`

export interface VolumeLine {
  /** The operator's label for these deals, or null when none was set */
  label: string | null
  /** True for deals labelled test, false for labelled non-test, null when unlabelled */
  isTest: boolean | null
  created: { deals: number; amount: bigint }
  funded: { deals: number; amount: bigint }
}

export interface OperatorIndexSummary {
  dealsByState: Record<string, number>
  volume: VolumeLine[]
  openDisputes: number
  cursors: { stream: string; block: bigint; updatedAt: number }[]
  adminLog: { name: string; block: bigint; txHash: string; time: number | null; args: Record<string, unknown> }[]
}

/** Aggregates over what the indexer has recorded. Counts are only as complete as the index; the chain figures below are live. */
export class PostgresOperatorStore {
  constructor(private readonly database: SqlExecutor) {}

  /** Labels every deal in the (already normalized, non-overlapping) ranges in one statement. */
  async setLabels(network: WaybillNetwork, ranges: readonly (readonly [bigint, bigint])[], label: string, isTest: boolean): Promise<number> {
    const result = await this.database.query<{ deal_id: string }>(SET_LABELS_SQL, [
      network,
      ranges.map(([from]) => from.toString()),
      ranges.map(([, to]) => to.toString()),
      label,
      isTest,
    ])
    return result.rows.length
  }

  async summary(network: WaybillNetwork, streams: readonly string[], logLimit = 20): Promise<OperatorIndexSummary> {
    const [states, volume, disputes, cursors, log] = await Promise.all([
      this.database.query<{ state: string; deals: number }>(STATE_SQL, [network]),
      this.database.query<{ event_name: string; label: string | null; is_test: boolean | null; deals: number; amount: string }>(VOLUME_SQL, [network]),
      this.database.query<{ open: number }>(DISPUTES_SQL, [network, ['DisputeRaised', ...DISPUTE_CLOSERS]]),
      this.database.query<{ stream: string; block_number: string; updated: string }>(CURSORS_SQL, [streams]),
      this.database.query<{ event_name: string; block_number: string; transaction_hash: string; block_timestamp: string | null; payload: Record<string, unknown> }>(ADMIN_LOG_SQL, [network, ADMIN_EVENT_NAMES, logLimit]),
    ])

    const lines = new Map<string, VolumeLine>()
    for (const row of volume.rows) {
      const key = `${row.label ?? ''}|${row.is_test}`
      const line = lines.get(key) ?? { label: row.label, isTest: row.is_test, created: { deals: 0, amount: 0n }, funded: { deals: 0, amount: 0n } }
      const slot = row.event_name === 'DealCreated' ? line.created : line.funded
      slot.deals += Number(row.deals)
      slot.amount += BigInt(row.amount.split('.')[0]!)
      lines.set(key, line)
    }
    return {
      dealsByState: Object.fromEntries(states.rows.map((r) => [r.state, Number(r.deals)])),
      volume: [...lines.values()],
      openDisputes: Number(disputes.rows[0]?.open ?? 0),
      cursors: cursors.rows.map((r) => ({ stream: r.stream, block: BigInt(r.block_number), updatedAt: Number(r.updated) })),
      adminLog: log.rows.map((r) => ({ name: r.event_name, block: BigInt(r.block_number), txHash: r.transaction_hash, time: r.block_timestamp === null ? null : Number(r.block_timestamp), args: r.payload })),
    }
  }
}

const ESCROW_READ_ABI = parseAbi([
  'function nextDealId() view returns (uint256)',
  'function currentLocked() view returns (uint256)',
  'function maxLocked() view returns (uint256)',
  'function maxDealAmount() view returns (uint256)',
  'function newDealsPaused() view returns (bool)',
  'function pauser() view returns (address)',
  'function treasury() view returns (address)',
])

export interface OperatorChainSummary {
  totalDeals: bigint
  currentLocked: bigint
  maxLocked: bigint
  maxDealAmount: bigint
  newDealsPaused: boolean
  pauser: `0x${string}`
  treasury: `0x${string}`
  relayer: { address: `0x${string}`; gasBalance: bigint }
  head: bigint
}

/** Live figures from the chain. Any failed read fails the whole summary: no half-true dashboard. */
export async function readOperatorChain(
  client: Pick<PublicClient, 'readContract' | 'getBalance' | 'getBlockNumber'>,
  manifest: Pick<WaybillNetworkManifest, 'contracts'>,
  relayerAddress: `0x${string}`,
): Promise<OperatorChainSummary> {
  const read = (functionName: (typeof ESCROW_READ_ABI)[number]['name']) =>
    client.readContract({ address: manifest.contracts.escrow, abi: ESCROW_READ_ABI, functionName } as never) as Promise<unknown>
  const [totalDeals, currentLocked, maxLocked, maxDealAmount, newDealsPaused, pauser, treasury, gasBalance, head] = await Promise.all([
    read('nextDealId'),
    read('currentLocked'),
    read('maxLocked'),
    read('maxDealAmount'),
    read('newDealsPaused'),
    read('pauser'),
    read('treasury'),
    client.getBalance({ address: relayerAddress }),
    client.getBlockNumber(),
  ])
  return {
    totalDeals: totalDeals as bigint,
    currentLocked: currentLocked as bigint,
    maxLocked: maxLocked as bigint,
    maxDealAmount: maxDealAmount as bigint,
    newDealsPaused: Boolean(newDealsPaused),
    pauser: pauser as `0x${string}`,
    treasury: treasury as `0x${string}`,
    relayer: { address: relayerAddress, gasBalance },
    head,
  }
}
