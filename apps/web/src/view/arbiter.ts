import type { Address } from 'viem'

/** One arbiter as the approved-list contract holds it. Amounts are raw 6-decimal USDC units. */
export interface Arbiter {
  address: Address
  /** On the list now, so it can be named on a new deal */
  allowed: boolean
  fee: bigint
  pendingAdd: { fee: bigint; eta: bigint } | null
  pendingRemove: { eta: bigint } | null
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/

function amount(value: unknown, what: string): bigint {
  if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value)
  throw new Error(`Arbiter ${what} is not a whole number`)
}

/** Validates the relayer's arbiter list. Throws on anything it does not understand. */
export function parseArbiters(raw: unknown): Arbiter[] {
  if (!Array.isArray(raw)) throw new Error('Arbiters are not a list')
  return raw.map((item): Arbiter => {
    if (!item || typeof item !== 'object') throw new Error('Arbiter is not an object')
    const r = item as Record<string, unknown>
    if (typeof r.address !== 'string' || !ADDRESS.test(r.address)) throw new Error('Arbiter has an invalid address')
    if (typeof r.allowed !== 'boolean') throw new Error('Arbiter has no allowed flag')
    const add = r.pendingAdd as Record<string, unknown> | null
    const remove = r.pendingRemove as Record<string, unknown> | null
    return {
      address: r.address as Address,
      allowed: r.allowed,
      fee: amount(r.fee, 'fee'),
      pendingAdd: add ? { fee: amount(add.fee, 'pending fee'), eta: amount(add.eta, 'pending time') } : null,
      pendingRemove: remove ? { eta: amount(remove.eta, 'pending time') } : null,
    }
  })
}
