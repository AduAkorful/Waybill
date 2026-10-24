import { parseAbi, type PublicClient } from 'viem'

import type { WaybillNetworkManifest } from '@waybill/network/networks'

export const ARBITER_EVENT_ABI = parseAbi([
  'event ArbiterAdded(address indexed arbiter, uint256 feeUsdc)',
  'event ArbiterRemoved(address indexed arbiter)',
  'event AddArbiterScheduled(address indexed arbiter, uint256 feeUsdc, uint64 eta)',
  'event AddArbiterExecuted(address indexed arbiter)',
  'event RemoveArbiterScheduled(address indexed arbiter, uint64 eta)',
  'event RemoveArbiterExecuted(address indexed arbiter)',
])

/** Event names that mean an address has a presence on the arbiter list. */
export const ARBITER_EVENT_NAMES = [
  'ArbiterAdded',
  'ArbiterRemoved',
  'AddArbiterScheduled',
  'AddArbiterExecuted',
  'RemoveArbiterScheduled',
  'RemoveArbiterExecuted',
] as const

const ARBITER_READ_ABI = parseAbi([
  'function isAllowed(address arbiter) view returns (bool)',
  'function feeUsdc(address arbiter) view returns (uint256)',
  'function getPendingAdd(address arbiter) view returns (uint256 fee, uint64 eta)',
  'function getPendingRemove(address arbiter) view returns (uint64 eta)',
])

/** One arbiter as the list contract holds it right now. Amounts are raw 6-decimal USDC units. */
export interface ArbiterRecord {
  address: `0x${string}`
  /** On the list now: can be named on a new deal */
  allowed: boolean
  /** The fee the arbiter advertises */
  fee: bigint
  /** A scheduled addition waiting out its delay, unix seconds */
  pendingAdd: { fee: bigint; eta: bigint } | null
  /** A scheduled removal waiting out its delay, unix seconds */
  pendingRemove: { eta: bigint } | null
}

/** Reads one arbiter's list state live. Throws if any read fails: no partial record. */
export async function readArbiter(
  client: Pick<PublicClient, 'readContract'>,
  manifest: Pick<WaybillNetworkManifest, 'contracts'>,
  address: `0x${string}`,
): Promise<ArbiterRecord> {
  const list = manifest.contracts.arbiterList
  const read = <N extends 'isAllowed' | 'feeUsdc' | 'getPendingAdd' | 'getPendingRemove'>(functionName: N) =>
    client.readContract({ address: list, abi: ARBITER_READ_ABI, functionName, args: [address] } as never) as Promise<unknown>
  const [allowed, fee, add, remove] = await Promise.all([read('isAllowed'), read('feeUsdc'), read('getPendingAdd'), read('getPendingRemove')])
  const [addFee, addEta] = add as readonly [bigint, bigint]
  return {
    address,
    allowed: Boolean(allowed),
    fee: fee as bigint,
    pendingAdd: addEta === 0n ? null : { fee: addFee, eta: addEta },
    pendingRemove: (remove as bigint) === 0n ? null : { eta: remove as bigint },
  }
}
