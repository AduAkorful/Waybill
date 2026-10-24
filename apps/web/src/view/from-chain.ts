import type { Address, PublicClient } from 'viem'
import type { WaybillNetworkManifest } from '@waybill/network/networks'
import { readDecisionOpensAt, readDeal, readMilestone, readPanelMembers, readPanelVote, readPartAttestors, readPendingChange, readTrancheFee } from '@/integration/escrow'
import {
  CONDITIONS,
  DEAL_STATES,
  FEE_PAYERS,
  MILESTONE_STATES,
  type DealTerms,
  type DealView,
  type PanelView,
  type PendingChange,
  type Tranche,
} from './types'

const ZERO = '0x0000000000000000000000000000000000000000'
const ZERO_HASH = '0x0000000000000000000000000000000000000000000000000000000000000000'

function word<T extends string>(list: readonly T[], value: number, what: string): T {
  const found = list[value]
  if (found === undefined) throw new Error(`Unknown ${what} value ${value} from the escrow`)
  return found
}

const addressOrNull = (a: `0x${string}`) => (a.toLowerCase() === ZERO ? null : a)
const hashOrNull = (h: `0x${string}`) => (h === ZERO_HASH ? null : h)

type ChainDeal = Awaited<ReturnType<typeof readDeal>>
type ChainMilestone = Awaited<ReturnType<typeof readMilestone>>

/**
 * The contract's own tranche rule: every part but the last is floor(total × bps / 10,000);
 * the last takes whatever is left, so the parts always add to the total exactly.
 */
export function trancheAmounts(total: bigint, bps: readonly bigint[]): bigint[] {
  const out: bigint[] = []
  let accumulated = 0n
  bps.forEach((b, i) => {
    if (i === bps.length - 1) out.push(total - accumulated)
    else {
      const amount = (total * b) / 10_000n
      accumulated += amount
      out.push(amount)
    }
  })
  return out
}

/** Pure mapping from the contract's structs to the view model. Throws on any value it does not understand. */
export function toDealView(
  id: bigint,
  deal: ChainDeal,
  milestones: readonly ChainMilestone[],
  fees: readonly bigint[],
  chainTime: bigint,
  terms?: DealTerms,
  pending: { payout: PendingChange | null; refund: PendingChange | null } = { payout: null, refund: null },
  attestors: readonly (readonly Address[])[] = [],
  panel: PanelView | null = null,
): DealView {
  if (milestones.length !== deal.milestoneCount || fees.length !== deal.milestoneCount) {
    throw new Error(`Deal ${id}: expected ${deal.milestoneCount} milestones, read ${milestones.length}`)
  }
  const amounts = trancheAmounts(
    deal.totalAmount,
    milestones.map((m) => m.bps),
  )
  const tranches: Tranche[] = milestones.map((m, i) => ({
    position: i,
    index: i + 1,
    bps: Number(m.bps),
    amount: amounts[i]!,
    fee: fees[i]!,
    condition: word(CONDITIONS, m.condition, 'release condition'),
    attestor: addressOrNull(m.attestor),
    attestors: [...(attestors[i] ?? [])],
    threshold: m.threshold,
    attestCount: m.attestCount,
    attestorAccepted: m.attestorAccepted,
    attested: m.attested,
    state: word(MILESTONE_STATES, m.state, 'milestone state'),
    deadline: m.deadline,
    gracePeriod: m.gracePeriod,
    reviewWindow: m.reviewWindow,
    reviewWindowStart: m.reviewWindowStart,
    evidenceHash: hashOrNull(m.evidenceHash),
    disputed: m.disputed,
    buyerRaisedDispute: m.buyerRaisedDispute,
    disputeRaiser: addressOrNull(m.disputeRaiser),
    disputeTime: m.disputeTime,
    responseDeadline: m.responseDeadline,
    responseSubmitted: m.responseSubmitted,
    arbiterDeadline: m.arbiterDeadline,
    ...(terms?.milestoneTitles?.[i] ? { title: terms.milestoneTitles[i] } : {}),
  }))
  return {
    id,
    buyer: deal.buyer,
    supplier: deal.supplier,
    supplierPayout: addressOrNull(deal.supplierPayout),
    buyerRefund: deal.buyerRefund,
    arbiter: deal.arbiter,
    panel,
    state: word(DEAL_STATES, deal.state, 'deal state'),
    totalAmount: deal.totalAmount,
    prepaidFee: deal.prepaidFee,
    feeBps: deal.feeBps,
    feePayer: word(FEE_PAYERS, deal.feePayer, 'fee payer'),
    arbiterFee: deal.arbiterFee,
    arbiterAccepted: deal.arbiterAccepted,
    fundFirst: deal.fundFirst,
    settled: deal.settled,
    acceptanceDeadline: deal.acceptanceDeadline,
    responsePeriodHours: deal.responsePeriodHours,
    tranches,
    pendingPayout: pending.payout,
    pendingRefund: pending.refund,
    chainTime,
    ...(terms ? { terms } : {}),
  }
}

/** Reads one deal and all its parts from the escrow, at one block time. */
export async function loadDealView(
  client: PublicClient,
  network: WaybillNetworkManifest,
  id: bigint,
  /** Off-chain details, or a read of them already under way so it does not delay the chain read */
  terms?: DealTerms | Promise<DealTerms | undefined>,
): Promise<DealView> {
  const [deal, block] = await Promise.all([readDeal(client, id, network), client.getBlock()])
  const positions = Array.from({ length: deal.milestoneCount }, (_, i) => i)
  const [milestones, fees, payout, refund, listed, members] = await Promise.all([
    Promise.all(positions.map((i) => readMilestone(client, id, i, network))),
    Promise.all(positions.map((i) => readTrancheFee(client, id, i, network))),
    readPendingChange(client, id, 'payout', network),
    readPendingChange(client, id, 'refund', network),
    Promise.all(positions.map((i) => readPartAttestors(client, id, i, network))),
    readPanelMembers(client, id, network),
  ])
  const panel = members ? await loadPanel(client, network, id, members, milestones) : null
  const waiting = (c: { proposed: `0x${string}`; eta: bigint }): PendingChange | null => (c.proposed.toLowerCase() === ZERO ? null : c)
  const view = toDealView(id, deal, milestones, fees, block.timestamp, await terms, { payout: waiting(payout), refund: waiting(refund) }, listed, panel)
  if (!network.earlyResolve) return view
  // only an escrow with the rebuttal rule can say when decisions open; read it for responded disputes only
  const opens = await Promise.all(
    view.tranches.map((t) => (t.state === 'disputed' && t.responseSubmitted ? readDecisionOpensAt(client, id, t.position, network) : Promise.resolve(null))),
  )
  return { ...view, tranches: view.tranches.map((t, i) => (opens[i] === null ? t : { ...t, decisionOpensAt: opens[i]! })) }
}

/** Votes are read only for parts that are, or were, in dispute: nobody can vote on any other part. */
async function loadPanel(
  client: PublicClient,
  network: WaybillNetworkManifest,
  id: bigint,
  members: readonly Address[],
  milestones: readonly ChainMilestone[],
): Promise<PanelView> {
  const votes: PanelView['votes'] = {}
  await Promise.all(
    milestones.map(async (m, i) => {
      const state = MILESTONE_STATES[m.state]
      if (state !== 'disputed' && state !== 'resolved') return
      const cast = await Promise.all(members.map((member) => readPanelVote(client, id, i, member, network)))
      votes[i] = Object.fromEntries(members.map((member, k) => [member.toLowerCase(), cast[k]!]))
    }),
  )
  return { members: [...members], votes }
}
