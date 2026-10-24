export type NotifyRole = 'buyer' | 'supplier' | 'attestor' | 'arbiter'

export interface PlannedParty {
  address: string
  role: 'buyer' | 'supplier' | 'arbiter' | 'panel' | 'attestor'
  milestoneIndex: number | null
}

export interface PlannedEvent {
  name: string
  dealId: bigint
  milestoneIndex?: number
  payload: Record<string, unknown>
}

export interface PlannedNotification {
  /** Lowercase wallet to look the email up for */
  wallet: string
  /** The role this wallet plays for this message; chooses the page the email links to */
  role: NotifyRole
  template: string
  /** Stable text that makes the same message to the same wallet unique, however many events lead to it */
  key: string
  data: Record<string, string>
}

const lower = (value: unknown): string => (typeof value === 'string' ? value.toLowerCase() : '')

/**
 * Who is told what when an escrow event is indexed. Pure: it reads only the event and the deal's named parties, and
 * names no email address. The person who did the thing is not told about it.
 */
export function planNotifications(event: PlannedEvent, parties: readonly PlannedParty[]): PlannedNotification[] {
  const of = (role: PlannedParty['role']) => [...new Set(parties.filter((p) => p.role === role).map((p) => p.address.toLowerCase()))]
  const buyer = of('buyer')
  const supplier = of('supplier')
  const arbiters = [...new Set([...of('arbiter'), ...of('panel')])]
  const attestors = [...new Set(parties.filter((p) => p.role === 'attestor').map((p) => p.address.toLowerCase()))]
  const part = event.milestoneIndex === undefined ? undefined : String(event.milestoneIndex + 1)
  const deal = String(event.dealId)

  const out = new Map<string, PlannedNotification>()
  const tell = (wallets: readonly string[], role: NotifyRole, template: string, data: Record<string, string> = {}, semanticKey?: string, except: string[] = []) => {
    for (const wallet of wallets) {
      if (except.includes(wallet) || out.has(wallet)) continue
      out.set(wallet, { wallet, role, template, data: { deal, ...(part ? { part } : {}), ...data }, key: `${deal}:${semanticKey ?? `${event.name}:${part ?? ''}`}:${template}:${wallet}` })
    }
  }
  const actor = lower(event.payload.raiser ?? event.payload.responder ?? event.payload.attestor ?? event.payload.submitter ?? event.payload.buyer)

  switch (event.name) {
    case 'DealCreated':
      tell(supplier, 'supplier', 'invited')
      tell(attestors, 'attestor', 'invited')
      tell(arbiters, 'arbiter', 'invited')
      break
    case 'SupplierAccepted':
      tell(buyer, 'buyer', 'accepted', { by: 'The supplier' })
      break
    case 'AttestorAccepted':
      tell(buyer, 'buyer', 'accepted', { by: 'An attestor' })
      break
    case 'ArbiterAccepted':
    case 'PanelMemberAccepted':
      tell(buyer, 'buyer', 'accepted', { by: 'An arbiter' })
      break
    case 'DealFunded':
      tell(supplier, 'supplier', 'funded')
      tell(attestors, 'attestor', 'funded')
      tell(arbiters, 'arbiter', 'funded')
      break
    case 'ThresholdMet':
      tell(buyer, 'buyer', 'confirmed')
      break
    case 'TrancheClaimed':
      tell(supplier, 'supplier', 'paid', { amount: String(event.payload.amount ?? '') })
      break
    case 'PayoutFailed':
      tell(supplier, 'supplier', 'payout_failed')
      break
    case 'RefundFailed':
      tell(buyer, 'buyer', 'refund_failed')
      break
    case 'MilestoneRefundable':
      tell(buyer, 'buyer', 'refundable')
      break
    case 'DisputeRaised':
      tell([...buyer, ...supplier], lower(event.payload.raiser) === supplier[0] ? 'buyer' : 'supplier', 'dispute_raised', {}, undefined, [actor])
      tell(arbiters, 'arbiter', 'dispute_raised')
      break
    case 'DisputeResponseAdded':
      tell([...buyer, ...supplier], lower(event.payload.responder) === supplier[0] ? 'buyer' : 'supplier', 'dispute_response', {}, undefined, [actor])
      tell(arbiters, 'arbiter', 'dispute_response')
      break
    case 'DisputeWithdrawn':
      tell(supplier, 'supplier', 'dispute_withdrawn')
      tell(arbiters, 'arbiter', 'dispute_withdrawn')
      break
    case 'DisputeResolved':
    case 'TrancheSplit':
    case 'PanelResolved':
    case 'DefaultApplied':
      // a panel decision emits more than one of these; the key is the part, so each person hears once
      tell(buyer, 'buyer', 'dispute_decided', {}, `decided:${part ?? ''}`)
      tell(supplier, 'supplier', 'dispute_decided', {}, `decided:${part ?? ''}`)
      break
    case 'PayoutChangeProposed':
      tell(buyer, 'buyer', 'payout_change', { to: lower(event.payload.newAddr) })
      break
    case 'RefundChangeProposed':
      tell(supplier, 'supplier', 'refund_change', { to: lower(event.payload.newAddr) })
      break
    case 'DealSettled':
      tell(buyer, 'buyer', 'settled')
      tell(supplier, 'supplier', 'settled')
      break
    case 'DealCancelled':
      tell(supplier, 'supplier', 'cancelled')
      tell(attestors, 'attestor', 'cancelled')
      tell(arbiters, 'arbiter', 'cancelled')
      break
  }
  return [...out.values()]
}
