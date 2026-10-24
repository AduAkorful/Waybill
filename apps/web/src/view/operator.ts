import type { Address } from 'viem'

export interface VolumeLine {
  label: string | null
  /** True for deals labelled test, false for labelled non-test, null when unlabelled */
  isTest: boolean | null
  created: { deals: number; amount: bigint }
  funded: { deals: number; amount: bigint }
}

export interface OperatorSummary {
  network: string
  chainId: number
  escrow: Address
  chain: {
    totalDeals: bigint
    currentLocked: bigint
    maxLocked: bigint
    maxDealAmount: bigint
    newDealsPaused: boolean
    pauser: Address
    treasury: Address
    /** The relayer's address and its native gas balance (18 decimals, not USDC token units) */
    relayer: { address: Address; gasBalance: bigint }
    head: bigint
  }
  index: {
    dealsByState: Record<string, number>
    volume: VolumeLine[]
    openDisputes: number
    cursors: { stream: string; block: bigint; updatedAt: number }[]
    adminLog: { name: string; block: bigint; txHash: string; time: number | null }[]
  }
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/

function big(v: unknown, what: string): bigint {
  if (typeof v === 'string' && /^\d+$/.test(v)) return BigInt(v)
  throw new Error(`Operator summary: ${what} is not a whole number`)
}
function int(v: unknown, what: string): number {
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0) return v
  throw new Error(`Operator summary: ${what} is not a count`)
}
function address(v: unknown, what: string): Address {
  if (typeof v === 'string' && ADDRESS.test(v)) return v as Address
  throw new Error(`Operator summary: ${what} is not an address`)
}
function obj(v: unknown, what: string): Record<string, unknown> {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>
  throw new Error(`Operator summary: ${what} is missing`)
}
function list(v: unknown, what: string): unknown[] {
  if (Array.isArray(v)) return v
  throw new Error(`Operator summary: ${what} is not a list`)
}

/** Validates the relayer's operator summary. Throws on anything it does not understand: no partial dashboard. */
export function parseOperatorSummary(raw: unknown): OperatorSummary {
  const r = obj(raw, 'summary')
  const c = obj(r.chain, 'chain')
  const relayer = obj(c.relayer, 'relayer')
  const i = obj(r.index, 'index')
  if (typeof c.newDealsPaused !== 'boolean') throw new Error('Operator summary: pause state is missing')
  if (typeof r.network !== 'string' || typeof r.chainId !== 'number') throw new Error('Operator summary: network is missing')
  const states = obj(i.dealsByState, 'deals by state')
  return {
    network: r.network,
    chainId: r.chainId,
    escrow: address(r.escrow, 'escrow'),
    chain: {
      totalDeals: big(c.totalDeals, 'deal count'),
      currentLocked: big(c.currentLocked, 'locked'),
      maxLocked: big(c.maxLocked, 'cap'),
      maxDealAmount: big(c.maxDealAmount, 'per-deal cap'),
      newDealsPaused: c.newDealsPaused,
      pauser: address(c.pauser, 'pauser'),
      treasury: address(c.treasury, 'treasury'),
      relayer: { address: address(relayer.address, 'relayer'), gasBalance: big(relayer.gasBalance, 'relayer balance') },
      head: big(c.head, 'head'),
    },
    index: {
      dealsByState: Object.fromEntries(Object.entries(states).map(([k, v]) => [k, int(v, `${k} count`)])),
      volume: list(i.volume, 'volume').map((row): VolumeLine => {
        const v = obj(row, 'volume line')
        const slot = (x: unknown, what: string) => {
          const o = obj(x, what)
          return { deals: int(o.deals, `${what} deals`), amount: big(o.amount, `${what} amount`) }
        }
        return {
          label: typeof v.label === 'string' ? v.label : null,
          isTest: typeof v.isTest === 'boolean' ? v.isTest : null,
          created: slot(v.created, 'created'),
          funded: slot(v.funded, 'funded'),
        }
      }),
      openDisputes: int(i.openDisputes, 'open disputes'),
      cursors: list(i.cursors, 'cursors').map((row) => {
        const v = obj(row, 'cursor')
        return { stream: String(v.stream), block: big(v.block, 'cursor block'), updatedAt: int(v.updatedAt, 'cursor time') }
      }),
      adminLog: list(i.adminLog, 'change log').map((row) => {
        const v = obj(row, 'log entry')
        return { name: String(v.name), block: big(v.block, 'log block'), txHash: String(v.txHash), time: typeof v.time === 'number' ? v.time : null }
      }),
    },
  }
}

/** How far behind the chain head a stream is, in blocks. Never negative. */
export const lagOf = (head: bigint, block: bigint): bigint => (head > block ? head - block : 0n)

/** Native gas has 18 decimals; the USDC token has 6. This is the one conversion, explicit, rounding down. */
export const gasToUsdcUnits = (gas: bigint): bigint => gas / 1_000_000_000_000n

const CHANGE_WORDS: Record<string, string> = {
  NewDealsPaused: 'New deals were paused',
  NewDealsUnpaused: 'New deals were resumed',
  SetTreasuryScheduled: 'A new treasury was scheduled',
  SetTreasuryExecuted: 'The treasury changed',
  SetFeeBpsRangeScheduled: 'A new fee range was scheduled',
  SetFeeBpsRangeExecuted: 'The fee range changed',
}
export const describeChange = (name: string): string => CHANGE_WORDS[name] ?? name
