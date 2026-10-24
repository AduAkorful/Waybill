import type { RelayerCandidate } from './chain'

export const MILESTONE_STATES = {
  WAITING: 0,
  IN_REVIEW: 1,
  CLAIMABLE: 2,
  RELEASED: 3,
  OVERDUE: 4,
  REFUNDABLE: 5,
  REFUNDED: 6,
  DISPUTED: 7,
  RESOLVED: 8,
} as const

export interface EligibilitySnapshot {
  state: number
  deadline: bigint
  gracePeriod: number
  disputed: boolean
  responseDeadline: bigint
  arbiterDeadline: bigint
}

export type EligibilityResult =
  | { eligible: true }
  | { eligible: false; reason: string }

export function checkCandidateEligibility(
  candidate: RelayerCandidate,
  snapshot: EligibilitySnapshot,
  nowSeconds: bigint,
): EligibilityResult {
  if (candidate.operation === 'claim') {
    return snapshot.state === MILESTONE_STATES.CLAIMABLE
      ? { eligible: true }
      : { eligible: false, reason: `claim requires CLAIMABLE state, got ${snapshot.state}` }
  }

  if (candidate.operation === 'refund') {
    return snapshot.state === MILESTONE_STATES.REFUNDABLE
      ? { eligible: true }
      : { eligible: false, reason: `refund requires REFUNDABLE state, got ${snapshot.state}` }
  }

  if (snapshot.state === MILESTONE_STATES.DISPUTED || snapshot.disputed) {
    return nowSeconds > snapshot.arbiterDeadline
      ? { eligible: true }
      : { eligible: false, reason: 'arbiter deadline is still active' }
  }

  if (snapshot.state === MILESTONE_STATES.OVERDUE) {
    const graceEnd = snapshot.deadline + BigInt(snapshot.gracePeriod) * 3_600n
    return nowSeconds > graceEnd
      ? { eligible: true }
      : { eligible: false, reason: 'milestone grace period is still active' }
  }

  return { eligible: false, reason: `default has no path from state ${snapshot.state}` }
}

export interface EventCursor {
  blockNumber: bigint
  logIndex: bigint
}

export interface CursorStore {
  get(): Promise<EventCursor | null>
  set(cursor: EventCursor): Promise<void>
}

function compareCursor(left: EventCursor, right: EventCursor): number {
  if (left.blockNumber !== right.blockNumber) {
    return left.blockNumber < right.blockNumber ? -1 : 1
  }
  if (left.logIndex === right.logIndex) return 0
  return left.logIndex < right.logIndex ? -1 : 1
}

export class MemoryCursorStore implements CursorStore {
  private cursor: EventCursor | null = null

  async get(): Promise<EventCursor | null> {
    return this.cursor
  }

  async set(cursor: EventCursor): Promise<void> {
    if (this.cursor && compareCursor(cursor, this.cursor) < 0) {
      throw new Error('Event cursor cannot move backwards')
    }
    this.cursor = cursor
  }
}
