import { isAddress, type Address } from 'viem'
import type { FeePayer, MilestoneInput, ReleaseCondition } from '@/integration/current-actions'

export const INDEPENDENT = 65_535
const DAY = 86_400
const HOUR = 3_600

export interface PartForm {
  /** Share of the total, as typed: up to two decimals */
  percent: string
  condition: ReleaseCondition
  /** Attestor wallets for an attestation part */
  attestors: string[]
  /** Days from now until the part is due */
  dueDays: string
  /** Days after the due date the buyer waits before taking the part back */
  graceDays: string
  /** Hours the buyer can review after the part is confirmed */
  reviewHours: string
}

export interface BuilderForm {
  supplier: string
  refund: string
  arbiter: string
  total: string
  feeBps: string
  feePayer: FeePayer
  /** Days the supplier and others have to accept */
  acceptDays: string
  /** Hours the arbiter has to decide a dispute */
  decisionHours: string
  parts: PartForm[]
}

/** What the escrow itself enforces, read from the chain. */
export interface BuilderLimits {
  minFeeBps: number
  maxFeeBps: number
  maxDealAmount: bigint
  maxLocked: bigint
  currentLocked: bigint
  newDealsPaused: boolean
}

/** The arbiter, as the list contract reports it. Null when the address is not on the list. */
export interface ArbiterCheck {
  allowed: boolean
  fee: bigint
}

export const CONDITION_LABEL: Record<ReleaseCondition, string> = {
  0: 'Paid when the supplier accepts and you fund',
  1: 'Paid when named attestors confirm',
  2: 'Paid when you approve (or the review ends)',
  3: 'Paid on the due date',
}

const part = (percent: string, condition: ReleaseCondition, dueDays: number, review = '24'): PartForm => ({
  percent,
  condition,
  attestors: condition === 1 ? [''] : [],
  dueDays: String(dueDays),
  graceDays: '7',
  reviewHours: review,
})

export interface Template {
  id: string
  name: string
  blurb: string
  parts: () => PartForm[]
}

/** Starting points only. Every figure stays editable and is checked again before anything is signed. */
export const TEMPLATES: readonly Template[] = [
  { id: 'single', name: 'One payment on confirmation', blurb: 'The whole amount is paid when an attestor confirms.', parts: () => [part('100', 1, 30)] },
  {
    id: 'standard',
    name: 'Deposit, production, delivery',
    blurb: '20% on acceptance, 30% when production is confirmed, 50% when delivery is confirmed.',
    parts: () => [part('20', 0, 7), part('30', 1, 30), part('50', 1, 60)],
  },
  {
    id: 'inspection',
    name: 'Deposit and inspected balance',
    blurb: '30% on acceptance, 70% when an inspector confirms the goods.',
    parts: () => [part('30', 0, 7), part('70', 1, 45)],
  },
  { id: 'custom', name: 'Custom', blurb: 'Choose the parts yourself, from two to eight.', parts: () => [part('50', 0, 7), part('50', 1, 45)] },
]

export function emptyForm(buyer: string, feeBps: number, template: Template = TEMPLATES[1]!): BuilderForm {
  return {
    supplier: '',
    refund: buyer,
    arbiter: '',
    total: '',
    feeBps: String(feeBps),
    feePayer: 0,
    acceptDays: '7',
    decisionHours: '168',
    parts: template.parts(),
  }
}

/** "1250.50" to raw 6-decimal units; null when it is not a plain amount with at most six decimals. */
export function parseAmount(text: string): bigint | null {
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(text.trim())
  if (!m) return null
  return BigInt(m[1]!) * 1_000_000n + BigInt((m[2] ?? '').padEnd(6, '0'))
}

/** "33.33" to 3333 bps; null when it is not a percentage with at most two decimals. */
export function percentToBps(text: string): number | null {
  const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(text.trim())
  if (!m) return null
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'))
}

function wholeNumber(text: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(text.trim())) return null
  const n = Number(text.trim())
  return n >= min && n <= max ? n : null
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

export interface BuiltDeal {
  supplier: Address
  buyerRefund: Address
  arbiter: Address
  totalAmount: bigint
  feeBps: number
  acceptanceDeadlineTs: bigint
  arbiterDeadlineHours: number
  milestoneInputs: MilestoneInput[]
  fundFirst: false
  arbiterFee: bigint
  feePayer: FeePayer
}

export type BuildResult = { ok: true; deal: BuiltDeal; fee: bigint } | { ok: false; errors: string[] }

/** The protocol fee the contract takes on a total: rounded up, as the escrow does. */
export const feeFor = (total: bigint, feeBps: number): bigint => (total * BigInt(feeBps) + 9_999n) / 10_000n

/** Checks every rule the escrow checks that can be known before signing, and builds the exact createDeal arguments. */
export function buildDeal(form: BuilderForm, buyer: string, limits: BuilderLimits, arbiter: ArbiterCheck | null, nowSeconds: number): BuildResult {
  const errors: string[] = []
  const addr = (value: string, what: string): Address | null => {
    if (!isAddress(value.trim(), { strict: false })) {
      errors.push(`${what} must be a wallet address (0x and 40 characters).`)
      return null
    }
    return value.trim() as Address
  }

  if (limits.newDealsPaused) errors.push('Creating new deals is paused right now.')

  const supplier = addr(form.supplier, 'The supplier')
  const refund = addr(form.refund, 'The refund address')
  const arb = addr(form.arbiter, 'The arbiter')
  if (supplier && same(supplier, buyer)) errors.push('The supplier cannot be your own wallet.')
  if (arb && same(arb, buyer)) errors.push('You cannot be the arbiter of your own deal.')
  if (arb && supplier && same(arb, supplier)) errors.push('The supplier cannot be the arbiter.')
  if (arb && arbiter && !arbiter.allowed) errors.push('That arbiter is not on the approved list.')
  if (arb && !arbiter) errors.push('The arbiter has not been checked against the approved list yet.')

  const total = parseAmount(form.total)
  if (total === null || total === 0n) errors.push('Enter the total in USDC, with up to six decimals.')
  else if (total > limits.maxDealAmount) errors.push(`The total is above the early-access limit per deal.`)

  const feeBps = wholeNumber(form.feeBps, limits.minFeeBps, limits.maxFeeBps)
  if (feeBps === null) errors.push(`The fee must be between ${limits.minFeeBps} and ${limits.maxFeeBps} basis points.`)

  const acceptDays = wholeNumber(form.acceptDays, 1, 90)
  if (acceptDays === null) errors.push('Give everyone between 1 and 90 days to accept.')
  const decisionHours = wholeNumber(form.decisionHours, 1, 24 * 90)
  if (decisionHours === null) errors.push('Give the arbiter a decision window of at least 1 hour.')

  if (form.parts.length < 1 || form.parts.length > 8) errors.push('A deal has between one and eight parts.')

  const inputs: MilestoneInput[] = []
  let bpsTotal = 0
  const named: string[] = []
  form.parts.forEach((p, i) => {
    const label = `Part ${i + 1}`
    const bps = percentToBps(p.percent)
    if (bps === null || bps === 0) errors.push(`${label}: enter a share like 30 or 33.33.`)
    else bpsTotal += bps
    const due = wholeNumber(p.dueDays, 1, 3650)
    if (due === null) errors.push(`${label}: due date must be 1 to 3650 days from now.`)
    const grace = wholeNumber(p.graceDays, 0, 365)
    if (grace === null) errors.push(`${label}: grace period must be 0 to 365 days.`)
    const review = wholeNumber(p.reviewHours, 0, 24 * 90)
    if (review === null) errors.push(`${label}: review window must be 0 to 2160 hours.`)

    let attestors: Address[] = []
    if (p.condition === 1) {
      attestors = p.attestors.filter((a) => a.trim() !== '').map((a) => addr(a, `${label}: the attestor`)).filter((a): a is Address => a !== null)
      if (attestors.length === 0) errors.push(`${label}: name at least one attestor.`)
      if (attestors.length > 5) errors.push(`${label}: at most five attestors.`)
      if (new Set(attestors.map((a) => a.toLowerCase())).size !== attestors.length) errors.push(`${label}: the same attestor is listed twice.`)
      for (const a of attestors) {
        named.push(a.toLowerCase())
        if (same(a, buyer)) errors.push(`${label}: you cannot confirm your own deal.`)
        if (supplier && same(a, supplier)) errors.push(`${label}: the supplier cannot be an attestor.`)
        if (arb && same(a, arb)) errors.push(`${label}: the arbiter cannot be an attestor.`)
      }
    }
    if (bps !== null && due !== null && grace !== null && review !== null) {
      inputs.push({
        bps: BigInt(bps),
        condition: p.condition,
        attestors,
        threshold: p.condition === 1 ? Math.max(1, attestors.length === 0 ? 1 : attestors.length) : 0,
        deadline: BigInt(nowSeconds + due * DAY),
        gracePeriod: grace * DAY,
        reviewWindow: review * HOUR,
        dependsOn: INDEPENDENT,
      })
    }
  })
  if (form.parts.length > 0 && bpsTotal !== 10_000) errors.push(`The parts add up to ${(bpsTotal / 100).toFixed(2)}%, not 100%.`)

  if (supplier && refund && arb && total !== null && total > 0n && feeBps !== null && acceptDays !== null && decisionHours !== null && errors.length === 0 && arbiter) {
    const fee = feeFor(total, feeBps)
    if (limits.currentLocked + total + fee + arbiter.fee > limits.maxLocked) {
      return { ok: false, errors: ['The early-access cap on money held in escrow would be exceeded. Try a smaller amount or wait for other deals to settle.'] }
    }
    return {
      ok: true,
      fee,
      deal: {
        supplier,
        buyerRefund: refund,
        arbiter: arb,
        totalAmount: total,
        feeBps,
        acceptanceDeadlineTs: BigInt(nowSeconds + acceptDays * DAY),
        arbiterDeadlineHours: decisionHours,
        milestoneInputs: inputs,
        fundFirst: false,
        arbiterFee: arbiter.fee,
        feePayer: form.feePayer,
      },
    }
  }
  return { ok: false, errors }
}
