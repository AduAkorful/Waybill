import type { Hex } from 'viem'
import { loadBrowserApiBaseUrl } from './api'
import { getBrowserNetwork } from './network'

/** The labels the relayer accepts, and what each means for volume. Must match the relayer's `DEAL_LABELS`. */
export const DEAL_LABELS = [
  { value: 'team', test: true, help: 'Deals made by the Waybill team' },
  { value: 'test', test: true, help: 'Deals made to test the product' },
  { value: 'self-dealing', test: true, help: 'One person on both sides of the deal' },
  { value: 'third-party', test: false, help: 'Real deals between people outside the team' },
] as const
export type DealLabel = (typeof DEAL_LABELS)[number]['value']

export type DealRange = readonly [from: bigint, to: bigint]

/** "0-278,281" style text, as it appears in the signed message. */
export function formatRanges(ranges: readonly DealRange[]): string {
  return ranges.map(([from, to]) => (from === to ? `${from}` : `${from}-${to}`)).join(',')
}

/** The exact text the pauser's wallet signs. Must match the relayer's labelMessage character for character. */
export function labelMessage(input: { network: string; chainId: number; escrow: string; ranges: readonly DealRange[]; label: DealLabel; signedAt: number }): string {
  return [
    'Waybill deal label',
    `network: ${input.network}`,
    `chain: ${input.chainId}`,
    `escrow: ${input.escrow.toLowerCase()}`,
    `deals: ${formatRanges(input.ranges)}`,
    `label: ${input.label}`,
    `signed: ${input.signedAt}`,
  ].join('\n')
}

/**
 * Reads "0-278, 281, 290-292" into sorted, non-overlapping ranges, or says what is wrong. `total` is how many deals
 * exist, so a deal number that does not exist yet is refused here as well as by the relayer.
 */
export function parseDealRanges(text: string, total: bigint): { ok: true; ranges: DealRange[]; count: bigint } | { ok: false; reason: string } {
  const parts = text.split(',').map((p) => p.trim()).filter((p) => p !== '')
  if (parts.length === 0) return { ok: false, reason: 'Enter at least one deal number, such as 0-278, 281.' }
  if (parts.length > 100) return { ok: false, reason: 'Too many ranges (the limit is 100).' }
  const ranges: DealRange[] = []
  for (const part of parts) {
    const m = /^(\d{1,15})(?:\s*-\s*(\d{1,15}))?$/.exec(part)
    if (!m) return { ok: false, reason: `"${part}" is not a deal number or a range like 0-278.` }
    const from = BigInt(m[1]!)
    const to = m[2] === undefined ? from : BigInt(m[2])
    if (to < from) return { ok: false, reason: `"${part}" runs backwards.` }
    if (to >= total) return { ok: false, reason: `Deal ${to} does not exist yet (the newest is ${total - 1n}).` }
    ranges.push([from, to])
  }
  ranges.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  let count = 0n
  for (let i = 0; i < ranges.length; i++) {
    if (i > 0 && ranges[i]![0] <= ranges[i - 1]![1]) return { ok: false, reason: 'Two ranges overlap.' }
    count += ranges[i]![1] - ranges[i]![0] + 1n
  }
  if (count > 10_000n) return { ok: false, reason: 'No more than 10,000 deals at a time.' }
  return { ok: true, ranges, count }
}

const ERRORS: Record<string, string> = {
  not_pauser: 'Only the pauser wallet can label deals.',
  signature_expired: 'The signature took too long. Try again.',
  unknown_deal: 'One of those deals does not exist.',
  chain_read_unavailable: 'The relayer could not read the chain just now. Nothing was changed.',
  labels_unavailable: 'Labelling is not available right now.',
}

export class LabelRequestError extends Error {
  constructor(readonly code: string) {
    super(ERRORS[code] ?? `The label was refused (${code}).`)
  }
}

/** Signs one message covering every deal in the request, then sends it. Returns how many deals now carry the label. */
export async function setDealLabels(input: {
  signer: string
  ranges: readonly DealRange[]
  label: DealLabel
  sign: (message: string) => Promise<Hex>
  fetcher?: typeof fetch
  now?: () => number
}): Promise<number> {
  const network = getBrowserNetwork()
  const signedAt = (input.now ?? (() => Math.floor(Date.now() / 1000)))()
  const signature = await input.sign(
    labelMessage({ network: network.network, chainId: network.chainId, escrow: network.contracts.escrow, ranges: input.ranges, label: input.label, signedAt }),
  )
  const response = await (input.fetcher ?? fetch)(`${loadBrowserApiBaseUrl()}/v1/operator/labels`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-waybill-signer': input.signer,
      'x-waybill-signature': signature,
      'x-waybill-signed-at': String(signedAt),
    },
    body: JSON.stringify({ ranges: input.ranges.map(([a, b]) => [a.toString(), b.toString()]), label: input.label }),
  })
  const body = (await response.json().catch(() => ({}))) as { error?: unknown; labelled?: unknown }
  if (!response.ok) throw new LabelRequestError(typeof body.error === 'string' ? body.error : `http_${response.status}`)
  if (typeof body.labelled !== 'number') throw new LabelRequestError('invalid_response')
  return body.labelled
}
