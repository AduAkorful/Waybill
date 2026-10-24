import { keccak256, toBytes, type Hex } from 'viem'

/**
 * Plain words for the escrow's custom errors. Only errors the escrow can raise to a person in the
 * app are listed; anything else is shown as the contract's own error name, never as a guess.
 */
const CONTRACT_ERROR_TEXT: Record<string, string> = {
  NewDealsPausedError: 'New deals are paused right now.',
  MaxLockedExceeded: 'This would put more in escrow than the early-access limit allows.',
  InvalidDealState: 'The deal is not in a state where that can be done.',
  AcceptanceExpired: 'The acceptance deadline has passed.',
  AcceptanceNotExpired: 'The deal can only be cancelled after its acceptance deadline.',
  AlreadyAccepted: 'This was already accepted.',
  NotFullyAccepted: 'Everyone named on the deal has to accept before it can be funded.',
  NotSupplier: 'Only the supplier named on the deal can do this.',
  NotAttestor: 'Only an attestor named on the deal can do this.',
  NotArbiter: 'Only the arbiter named on the deal can do this.',
  NotBuyer: 'Only the buyer can do this.',
  NotParticipant: 'Only someone named on the deal can do this.',
  InvalidMilestoneState: 'This part is not in a state where that can be done.',
  AlreadyAttested: 'This attestor has already signed for this part.',
  AttestorAlreadyAccepted: 'This attestor has already accepted.',
  SignatureExpired: 'The signature has expired. Sign again.',
  AttestationUsed: 'That signed statement was already used.',
  InvalidSigner: 'The signature does not match a named attestor.',
  GraceExpired: 'The grace period for this part has ended.',
  GraceActive: 'The grace period for this part is still running.',
  TimedNotReached: 'The due date for this part has not been reached yet.',
  ReviewActive: 'The buyer review window for this part is still open.',
  ArbiterDeadlinePassed: "The arbiter's deadline has passed.",
  ArbiterDeadlineActive: "The arbiter's deadline has not passed yet.",
  BuyerDisputeNotInReview: 'The buyer can only dispute a part that is waiting in review.',
  SupplierDisputeNotOverdue: 'The supplier can only dispute a part that is overdue.',
  NotDisputed: 'This part is not in dispute.',
  Disputed: 'This part is in dispute.',
  NoDefaultPath: 'There is no default outcome to apply yet.',
  NotDisputeResponder: 'Only the other side of the dispute can respond.',
  ResponseWindowClosed: 'The time to respond has ended.',
  ResponseAlreadySubmitted: 'A response was already filed.',
  ResponseWindowOpen: 'The other side can still respond, so it cannot be decided yet.',
  EvidenceHashZero: 'Add at least one file or note first.',
  NotBuyerRaisedDispute: 'Only the buyer who raised the dispute can withdraw it.',
  DisputeAlreadyWithdrawn: 'The dispute is no longer open.',
  NotClaimable: 'This part cannot be paid out yet.',
  NotRefundable: 'This part cannot be refunded yet.',
  SupplierNotAccepted: 'The supplier has not accepted yet, so there is no payout address.',
  NoPendingChange: 'There is no waiting address change.',
  ChangeDelayActive: 'The 48-hour wait for this address change is not over yet.',
  ZeroAddressProposal: 'That address is not allowed.',
  InvalidDependsOn: 'That part depends on a part that is not ready.',
  InvalidVoteEncoding: 'That vote is not valid.',
}

const SELECTORS: Map<string, string> = new Map(
  Object.keys(CONTRACT_ERROR_TEXT).map((name) => [keccak256(toBytes(`${name}()`)).slice(0, 10), name]),
)

export function contractErrorName(data: Hex | undefined): string | undefined {
  if (!data || data.length < 10) return undefined
  return SELECTORS.get(data.slice(0, 10).toLowerCase())
}

export function contractErrorText(name: string): string {
  return CONTRACT_ERROR_TEXT[name] ?? `The contract refused it (${name}).`
}

function* causes(error: unknown): Generator<unknown> {
  const seen = new Set<unknown>()
  let current: unknown = error
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current)
    yield current
    current = (current as { cause?: unknown }).cause
  }
}

/** Revert data carried anywhere in a viem error's cause chain. */
export function revertDataOf(error: unknown): Hex | undefined {
  for (const link of causes(error)) {
    const data = (link as { data?: unknown }).data
    if (typeof data === 'string' && data.startsWith('0x')) return data as Hex
    if (data && typeof data === 'object') {
      const inner = (data as { data?: unknown }).data
      if (typeof inner === 'string' && inner.startsWith('0x')) return inner as Hex
    }
  }
  return undefined
}

/** True only when the person closed or declined the wallet prompt. Looks at error codes and
 *  names, never loose wording, so a network failure can never be mistaken for a decline. */
export function isUserRejection(error: unknown): boolean {
  for (const link of causes(error)) {
    const e = link as { code?: unknown; name?: unknown }
    if (e.code === 4001 || e.code === 'ACTION_REJECTED') return true
    if (e.name === 'UserRejectedRequestError') return true
  }
  return false
}

/** Transport trouble: the chain could not be reached or answered with a limit. */
export function isTransportFailure(error: unknown): boolean {
  for (const link of causes(error)) {
    const e = link as { name?: unknown; status?: unknown; code?: unknown }
    if (
      e.name === 'HttpRequestError' ||
      e.name === 'TimeoutError' ||
      e.name === 'RpcRequestError' ||
      e.name === 'WebSocketRequestError'
    ) {
      return true
    }
    if (e.status === 429 || e.status === 503 || e.status === 502 || e.status === 504) return true
    if (e.code === -32005 || e.code === -32603) return true
  }
  return false
}
