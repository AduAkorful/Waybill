import { verifyMessage, type Address, type Hex } from 'viem'

import { SIGNATURE_WINDOW_SECONDS } from './evidence-auth'

/**
 * The only labels a deal can carry, and whether each counts as test volume. A fixed list keeps the operator
 * console's groups comparable: free text would split the same kind of deal across spellings.
 */
export const DEAL_LABELS = { team: true, test: true, 'self-dealing': true, 'third-party': false } as const
export type DealLabel = keyof typeof DEAL_LABELS

export const MAX_LABELLED_DEALS = 10_000

export type DealRange = readonly [from: bigint, to: bigint]

export class LabelError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code)
  }
}

export function isDealLabel(value: unknown): value is DealLabel {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(DEAL_LABELS, value)
}

/** Sorts, then rejects overlaps and inverted ranges, so one statement never touches a deal twice. */
export function normalizeRanges(ranges: readonly DealRange[]): DealRange[] {
  if (ranges.length === 0 || ranges.length > 100) throw new LabelError('invalid_ranges', 400)
  const sorted = [...ranges].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  let count = 0n
  let previousEnd = -1n
  for (const [from, to] of sorted) {
    if (from < 0n || to < from || from <= previousEnd) throw new LabelError('invalid_ranges', 400)
    count += to - from + 1n
    previousEnd = to
  }
  if (count > BigInt(MAX_LABELLED_DEALS)) throw new LabelError('too_many_deals', 400)
  return sorted
}

/** "0-278,281" style text, as it appears in the signed message. */
export function formatRanges(ranges: readonly DealRange[]): string {
  return ranges.map(([from, to]) => (from === to ? `${from}` : `${from}-${to}`)).join(',')
}

export interface LabelContext {
  network: string
  chainId: number
  escrow: Address
}

/**
 * The exact text the pauser's wallet signs. It binds the network, escrow, every deal in the request and the label,
 * so a signature cannot be reused for other deals or another label.
 */
export function labelMessage(context: LabelContext, ranges: readonly DealRange[], label: DealLabel, signedAt: number): string {
  return [
    'Waybill deal label',
    `network: ${context.network}`,
    `chain: ${context.chainId}`,
    `escrow: ${context.escrow.toLowerCase()}`,
    `deals: ${formatRanges(ranges)}`,
    `label: ${label}`,
    `signed: ${signedAt}`,
  ].join('\n')
}

export interface LabelStore {
  /** Sets the label on every deal in the ranges. Returns how many deals now carry it. */
  setLabels(ranges: readonly DealRange[], label: DealLabel, isTest: boolean): Promise<number>
}

export interface LabelServiceOptions {
  context: LabelContext
  store: LabelStore
  /** Live pauser address from the escrow. */
  readPauser(): Promise<Address>
  /** Live count of deals created, so no label is written for a deal that does not exist. */
  readTotalDeals(): Promise<bigint>
  now?: () => number
}

export interface LabelRequest {
  signer: string
  signature: string
  signedAt: number
  ranges: readonly DealRange[]
  label: unknown
}

/** Lets the escrow's pauser wallet label deals as team, test, self-dealing or third-party. Nobody else can. */
export class LabelService {
  constructor(private readonly options: LabelServiceOptions) {}

  async set(request: LabelRequest): Promise<{ labelled: number; label: DealLabel }> {
    if (!isDealLabel(request.label)) throw new LabelError('invalid_label', 400)
    const label = request.label
    const ranges = normalizeRanges(request.ranges)
    if (!/^0x[0-9a-fA-F]{40}$/.test(request.signer)) throw new LabelError('invalid_signer', 401)
    if (!/^0x[0-9a-fA-F]+$/.test(request.signature)) throw new LabelError('invalid_signature', 401)
    const now = (this.options.now ?? (() => Math.floor(Date.now() / 1000)))()
    if (!Number.isInteger(request.signedAt) || Math.abs(now - request.signedAt) > SIGNATURE_WINDOW_SECONDS) {
      throw new LabelError('signature_expired', 401)
    }
    let valid = false
    try {
      valid = await verifyMessage({
        address: request.signer as Address,
        message: labelMessage(this.options.context, ranges, label, request.signedAt),
        signature: request.signature as Hex,
      })
    } catch {
      valid = false
    }
    if (!valid) throw new LabelError('signature_mismatch', 401)

    let pauser: Address
    let total: bigint
    try {
      ;[pauser, total] = await Promise.all([this.options.readPauser(), this.options.readTotalDeals()])
    } catch {
      throw new LabelError('chain_read_unavailable', 503)
    }
    if (request.signer.toLowerCase() !== pauser.toLowerCase()) throw new LabelError('not_pauser', 403)
    if (ranges[ranges.length - 1]![1] >= total) throw new LabelError('unknown_deal', 400)

    const labelled = await this.options.store.setLabels(ranges, label, DEAL_LABELS[label])
    return { labelled, label }
  }
}
