import type { Hex } from 'viem'
import type { DealEvent, DealView, SplitDecision } from './types'

const HASH = /^0x[0-9a-fA-F]{64}$/

function bigint(value: unknown, what: string): bigint {
  if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value)
  throw new Error(`Event field ${what} is not a whole number`)
}

/** Validates the relayer's event list. Throws on anything it does not understand: no partial history. */
export function parseDealEvents(raw: unknown): DealEvent[] {
  if (!Array.isArray(raw)) throw new Error('Event list is not an array')
  return raw.map((row): DealEvent => {
    if (!row || typeof row !== 'object') throw new Error('Event row is not an object')
    const r = row as Record<string, unknown>
    if (typeof r.eventName !== 'string' || r.eventName === '') throw new Error('Event has no name')
    if (typeof r.transactionHash !== 'string' || !HASH.test(r.transactionHash)) {
      throw new Error('Event has an invalid transaction hash')
    }
    const milestone = r.milestoneIndex
    if (milestone !== null && !(typeof milestone === 'number' && Number.isInteger(milestone) && milestone >= 0)) {
      throw new Error('Event has an invalid part position')
    }
    const payload = r.payload
    if (!payload || typeof payload !== 'object') throw new Error('Event has no arguments')
    return {
      name: r.eventName,
      position: milestone as number | null,
      blockNumber: bigint(r.blockNumber, 'blockNumber'),
      logIndex: bigint(r.logIndex, 'logIndex'),
      txHash: r.transactionHash as Hex,
      time: r.blockTimestamp === null ? null : bigint(r.blockTimestamp, 'blockTimestamp'),
      args: payload as Record<string, unknown>,
    }
  })
}

/** Arbiter splits, one per TrancheSplit event. */
export function splitDecisions(events: readonly DealEvent[]): SplitDecision[] {
  return events
    .filter((e) => e.name === 'TrancheSplit')
    .map((e) => {
      if (e.position === null) throw new Error('TrancheSplit event has no part position')
      return {
        position: e.position,
        supplierBps: Number(bigint(e.args.supplierBps, 'supplierBps')),
        supplierAmount: bigint(e.args.supplierAmount, 'supplierAmount'),
        buyerPrincipal: bigint(e.args.buyerAmount, 'buyerAmount'),
      }
    })
}

/** Attaches the indexed history and the splits found in it. */
export function withEvents(view: DealView, events: readonly DealEvent[]): DealView {
  return { ...view, events: [...events], splits: splitDecisions(events) }
}

/** Whether this wallet has already signed for a part, read from the indexed `AttestationSubmitted` events. */
export function hasSigned(events: readonly DealEvent[] | undefined, position: number, wallet: string): boolean {
  return (events ?? []).some(
    (e) => e.name === 'AttestationSubmitted' && e.position === position && String(e.args.attestor ?? '').toLowerCase() === wallet.toLowerCase(),
  )
}
