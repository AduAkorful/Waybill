import type { Address } from 'viem'
import { parseDealEvents } from './events'
import { formatDateTime } from './format'
import type { DealEvent } from './types'

export type AttestorStatus = 'none' | 'registered' | 'suspended'

/** One attestor as the registry holds it. Counts are the contract's own ledger. */
export interface Attestor {
  address: Address
  status: AttestorStatus
  /** Statements they signed that led to a release */
  attested: number
  /** Disputes decided against their confirmation */
  upheld: number
  slashed: number
  profile: { name: string; city: string; agentId: bigint } | null
  pending: { status: AttestorStatus; eta: bigint; automatic: boolean } | null
  /** Registry history, oldest first. Present on a profile read only */
  events?: DealEvent[]
}

const STATUSES: readonly AttestorStatus[] = ['none', 'registered', 'suspended']
const ADDRESS = /^0x[0-9a-fA-F]{40}$/

function count(value: unknown, what: string): number {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value
  throw new Error(`Attestor ${what} is not a whole number`)
}

function status(value: unknown): AttestorStatus {
  if (STATUSES.includes(value as AttestorStatus)) return value as AttestorStatus
  throw new Error('Attestor status is not one the registry defines')
}

/** Validates one attestor from the relayer. Throws on anything it does not understand. */
export function parseAttestor(raw: unknown): Attestor {
  if (!raw || typeof raw !== 'object') throw new Error('Attestor is not an object')
  const r = raw as Record<string, unknown>
  if (typeof r.address !== 'string' || !ADDRESS.test(r.address)) throw new Error('Attestor has an invalid address')
  const p = r.profile as Record<string, unknown> | null
  const pending = r.pending as Record<string, unknown> | null
  return {
    address: r.address as Address,
    status: status(r.status),
    attested: count(r.attested, 'attested count'),
    upheld: count(r.upheld, 'upheld count'),
    slashed: count(r.slashed, 'slashed count'),
    profile: p
      ? { name: String(p.name ?? ''), city: String(p.city ?? ''), agentId: BigInt(String(p.agentId ?? '0')) }
      : null,
    pending: pending ? { status: status(pending.status), eta: BigInt(String(pending.eta)), automatic: pending.automatic === true } : null,
    ...(r.events === undefined ? {} : { events: parseDealEvents(r.events) }),
  }
}

export function parseAttestors(raw: unknown): Attestor[] {
  if (!Array.isArray(raw)) throw new Error('Attestor list is not an array')
  return raw.map(parseAttestor)
}

/** The name people see: their own profile name, otherwise nothing invented. */
export const attestorName = (a: Attestor): string | null => (a.profile?.name ? a.profile.name : null)

export const statusWords: Record<AttestorStatus, string> = {
  none: 'Not registered',
  registered: 'Registered',
  suspended: 'Suspended',
}

/** One registry event in plain words, from its own arguments. Unknown events show their contract name. */
export function describeAttestorEvent(e: DealEvent): string {
  const a = e.args
  switch (e.name) {
    case 'OutcomeRecorded':
      return a.kind === 0
        ? 'A statement they signed was recorded'
        : a.kind === 1
          ? 'A dispute was decided against their confirmation'
          : 'Part of their bond was slashed'
    case 'ProfileUpdated':
      return 'Updated their profile'
    case 'StatusScheduled':
      return `A change to “${STATUSES[Number(a.status)] ?? 'unknown'}” was scheduled`
    case 'StatusExecuted':
      return `Status became “${STATUSES[Number(a.status)] ?? 'unknown'}”`
    case 'AutoSuspensionScheduled':
      return `Suspension scheduled after repeated upheld disputes${typeof a.eta === 'string' ? `, effective ${formatDateTime(BigInt(a.eta))}` : ''}`
    case 'AutoSuspensionCancelled':
      return 'A scheduled suspension was cancelled'
    default:
      return e.name
  }
}
