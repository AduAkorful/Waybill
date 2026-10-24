import type { WaybillNetwork } from '@waybill/network/networks'
import type { EventCursor } from './eligibility'

export interface ReconciliationInput {
  network: WaybillNetwork
  observedNetwork: WaybillNetwork
  chainHead: bigint
  cursor: EventCursor | null
  latestProjectionBlock: bigint | null
  currentLocked: bigint
  escrowTokenBalance: bigint
}

export interface ReconciliationIssue {
  code:
    | 'NETWORK_MISMATCH'
    | 'NEGATIVE_OBSERVATION'
    | 'CURSOR_AHEAD_OF_HEAD'
    | 'PROJECTION_AHEAD_OF_HEAD'
    | 'ESCROW_UNDERCOLLATERALIZED'
  detail: string
}

export interface ReconciliationResult {
  ok: boolean
  issues: ReconciliationIssue[]
}

export function reconcile(input: ReconciliationInput): ReconciliationResult {
  const issues: ReconciliationIssue[] = []
  if (input.network !== input.observedNetwork) {
    issues.push({
      code: 'NETWORK_MISMATCH',
      detail: `configured ${input.network}, observed ${input.observedNetwork}`,
    })
  }
  if (
    input.chainHead < 0n ||
    input.currentLocked < 0n ||
    input.escrowTokenBalance < 0n ||
    (input.cursor && (input.cursor.blockNumber < 0n || input.cursor.logIndex < 0n)) ||
    (input.latestProjectionBlock !== null && input.latestProjectionBlock < 0n)
  ) {
    issues.push({
      code: 'NEGATIVE_OBSERVATION',
      detail: 'reconciliation observations must be non-negative',
    })
  }
  if (input.cursor && input.cursor.blockNumber > input.chainHead) {
    issues.push({
      code: 'CURSOR_AHEAD_OF_HEAD',
      detail: `${input.cursor.blockNumber} > ${input.chainHead}`,
    })
  }
  if (input.latestProjectionBlock !== null && input.latestProjectionBlock > input.chainHead) {
    issues.push({
      code: 'PROJECTION_AHEAD_OF_HEAD',
      detail: `${input.latestProjectionBlock} > ${input.chainHead}`,
    })
  }
  if (input.escrowTokenBalance < input.currentLocked) {
    issues.push({
      code: 'ESCROW_UNDERCOLLATERALIZED',
      detail: `${input.escrowTokenBalance} < ${input.currentLocked}`,
    })
  }
  return { ok: issues.length === 0, issues }
}
