import { parseAbi, type PublicClient } from 'viem'

import type { WaybillNetworkManifest } from '@waybill/network/networks'

export const REGISTRY_EVENT_ABI = parseAbi([
  'event WriterAdded(address indexed writer)',
  'event WriterRemoved(address indexed writer)',
  'event OutcomeRecorded(address indexed attestor, uint8 kind, uint32 attested, uint32 upheld, uint32 slashed)',
  'event StatusScheduled(address indexed attestor, uint8 status, uint64 eta)',
  'event StatusExecuted(address indexed attestor, uint8 status)',
  'event AutoSuspensionScheduled(address indexed attestor, uint64 eta)',
  'event AutoSuspensionCancelled(address indexed attestor)',
  'event ProfileUpdated(address indexed attestor, string name, string city, uint64 agentId)',
])

/** Event names that mean an address has a presence in the registry. */
export const REGISTRY_EVENT_NAMES = [
  'OutcomeRecorded',
  'StatusScheduled',
  'StatusExecuted',
  'AutoSuspensionScheduled',
  'AutoSuspensionCancelled',
  'ProfileUpdated',
] as const

const REGISTRY_READ_ABI = parseAbi([
  'function status(address attestor) view returns (uint8)',
  'function counts(address attestor) view returns (uint32 attested, uint32 upheld, uint32 slashed)',
  'function getProfile(address attestor) view returns (string name, string city, uint64 agentId)',
  'function getPendingStatus(address attestor) view returns (uint8 pendingStatus, uint64 eta)',
  'function isAutoSuspensionPending(address attestor) view returns (bool)',
])

const STATUS = ['none', 'registered', 'suspended'] as const
export type AttestorStatus = (typeof STATUS)[number]

/** One attestor as the registry holds it right now. Counts are the contract's own ledger. */
export interface AttestorRecord {
  address: `0x${string}`
  status: AttestorStatus
  attested: number
  upheld: number
  slashed: number
  profile: { name: string; city: string; agentId: bigint } | null
  /** A status change waiting out its delay, unix seconds */
  pending: { status: AttestorStatus; eta: bigint; automatic: boolean } | null
}

function statusWord(value: number): AttestorStatus {
  const word = STATUS[value]
  if (!word) throw new Error(`Unknown attestor status ${value} from the registry`)
  return word
}

/** Reads one attestor's registry state live. Throws if any read fails: no partial record. */
export async function readAttestor(
  client: Pick<PublicClient, 'readContract'>,
  manifest: Pick<WaybillNetworkManifest, 'contracts'>,
  address: `0x${string}`,
): Promise<AttestorRecord> {
  const registry = manifest.contracts.attestorRegistry
  const read = <N extends 'status' | 'counts' | 'getProfile' | 'getPendingStatus' | 'isAutoSuspensionPending'>(functionName: N) =>
    client.readContract({ address: registry, abi: REGISTRY_READ_ABI, functionName, args: [address] } as never) as Promise<unknown>
  const [status, counts, profile, pending, automatic] = await Promise.all([
    read('status'),
    read('counts'),
    read('getProfile'),
    read('getPendingStatus'),
    read('isAutoSuspensionPending'),
  ])
  const [attested, upheld, slashed] = counts as readonly [number, number, number]
  const [name, city, agentId] = profile as readonly [string, string, bigint]
  const [pendingStatus, eta] = pending as readonly [number, bigint]
  return {
    address,
    status: statusWord(Number(status)),
    attested,
    upheld,
    slashed,
    profile: name === '' && city === '' && agentId === 0n ? null : { name, city, agentId },
    pending: eta === 0n ? null : { status: statusWord(pendingStatus), eta, automatic: Boolean(automatic) },
  }
}
