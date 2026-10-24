import type { WaybillNetwork } from '@waybill/network/networks'
import type { Alert, AlertField, AlertLevel } from './alerts'

/** Where an alert is being sent from: the network, and its explorer so addresses and transactions become links. */
export interface AlertContext {
  network: WaybillNetwork
  explorerUrl?: string
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/
const WHOLE = /^\d+$/

/** Event arguments shown as labelled fields; anything not listed is labelled from its own name. */
const LABELS: Record<string, string> = {
  writer: 'Writer',
  arbiter: 'Arbiter',
  recipient: 'Recipient',
  amount: 'Amount',
  proposed: 'Proposed treasury',
  oldTreasury: 'Old treasury',
  newTreasury: 'New treasury',
  maxDealAmount: 'Largest single deal',
  maxLocked: 'Most held at once',
  minBps: 'Lowest fee',
  maxBps: 'Highest fee',
  feeUsdc: 'Advertised fee',
  eta: 'Takes effect',
}
/** Token amounts: raw 6-decimal USDC units */
const USDC_KEYS = new Set(['amount', 'maxDealAmount', 'maxLocked', 'feeUsdc'])
const BPS_KEYS = new Set(['minBps', 'maxBps'])

const words = (key: string) => key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase())

/** Raw 6-decimal units as "1,000.00 USDC", keeping any sub-cent digits rather than rounding them away. */
export function usdc(units: bigint): string {
  const whole = (units / 1_000_000n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const fraction = (units % 1_000_000n).toString().padStart(6, '0').replace(/0{1,4}$/, '')
  return `${whole}.${fraction.padEnd(2, '0')} USDC`
}

const utc = (seconds: bigint) => new Date(Number(seconds) * 1000).toUTCString().replace('GMT', 'UTC')

/** One event argument as a field, or null when it has nothing to show. */
function argumentField(key: string, raw: unknown): AlertField | null {
  if (raw === null || raw === undefined) return null
  const text = typeof raw === 'bigint' ? raw.toString() : String(raw)
  const name = LABELS[key] ?? words(key)
  if (ADDRESS.test(text)) return { name, value: text, kind: 'address' }
  if (WHOLE.test(text) && USDC_KEYS.has(key)) return { name, value: usdc(BigInt(text)) }
  if (WHOLE.test(text) && BPS_KEYS.has(key)) return { name, value: `${text} bps (${(Number(text) / 100).toFixed(2)}%)` }
  if (WHOLE.test(text) && key === 'eta') return { name, value: text, kind: 'time' }
  return { name, value: text }
}

/** The fields an indexed event shows: which deal and part, then each of its arguments. */
export function eventFields(event: { dealId?: bigint; milestoneIndex?: number; payload: Record<string, unknown> }): AlertField[] {
  const fields: AlertField[] = []
  if (event.dealId !== undefined) fields.push({ name: 'Deal', value: event.dealId.toString() })
  if (event.milestoneIndex !== undefined) fields.push({ name: 'Part', value: String(event.milestoneIndex + 1) })
  for (const [key, raw] of Object.entries(event.payload)) {
    if (key === 'dealId' || key === 'milestoneIndex') continue
    const field = argumentField(key, raw)
    if (field) fields.push(field)
  }
  return fields
}

const link = (base: string | undefined, kind: 'address' | 'tx', id: string) => (base ? `${base.replace(/\/$/, '')}/${kind}/${id}` : null)
const short = (id: string) => `${id.slice(0, 6)}…${id.slice(-4)}`

/** The plain-text body used in logs and email: the note, each field on its own line, then the transaction. */
export function plainDetail(alert: Pick<Alert, 'note' | 'fields' | 'txHash'>, explorerUrl?: string): string {
  const lines = alert.note ? [alert.note] : []
  for (const f of alert.fields ?? []) lines.push(`${f.name}: ${f.kind === 'time' ? utc(BigInt(f.value)) : f.value}`)
  if (alert.txHash) lines.push(`Transaction: ${link(explorerUrl, 'tx', alert.txHash) ?? alert.txHash}`)
  return lines.join('\n')
}

const EMOJI: Record<AlertLevel, string> = { critical: '🔴', warning: '🟠', info: '🟢' }
const COLOR: Record<AlertLevel, number> = { critical: 0xe5484d, warning: 0xf5a524, info: 0x30a46c }

/** A Discord webhook message: one embed, coloured by level, with explorer links and times in the reader's own zone. */
export function discordMessage(alert: Alert, context: AlertContext, now = new Date()) {
  const value = (f: AlertField) => {
    if (f.kind === 'address') {
      // in full, in a code span, so it can be copied as is (to fund a wallet, say); the explorer link sits beside it
      const url = link(context.explorerUrl, 'address', f.value)
      return url ? `\`${f.value}\`\n[View on explorer](${url})` : `\`${f.value}\``
    }
    if (f.kind === 'time') return `<t:${f.value}:F> (<t:${f.value}:R>)`
    return f.value
  }
  const txUrl = alert.txHash ? link(context.explorerUrl, 'tx', alert.txHash) : null
  // a full address does not fit a narrow inline column, so address fields take the whole row
  const fields = (alert.fields ?? []).map((f) => ({ name: f.name, value: value(f), inline: f.kind !== 'address' }))
  if (alert.txHash) fields.push({ name: 'Transaction', value: txUrl ? `[${short(alert.txHash)}](${txUrl})` : alert.txHash, inline: false })
  return {
    username: 'Waybill',
    allowed_mentions: { parse: [] },
    embeds: [
      {
        title: `${EMOJI[alert.level]} ${alert.title}`.slice(0, 256),
        ...(txUrl ? { url: txUrl } : {}),
        description: (alert.note ?? alert.detail).slice(0, 4000),
        color: COLOR[alert.level],
        fields: fields.slice(0, 25),
        footer: { text: `Waybill ${context.network} · ${alert.level}` },
        timestamp: now.toISOString(),
      },
    ],
  }
}

/** A Slack-style message: bold title, the note, one bullet per field, links in Slack's own syntax. */
export function slackText(alert: Alert, context: AlertContext): string {
  const value = (f: AlertField) => {
    if (f.kind === 'address') {
      const url = link(context.explorerUrl, 'address', f.value)
      return url ? `\`${f.value}\` (<${url}|explorer>)` : `\`${f.value}\``
    }
    return f.kind === 'time' ? utc(BigInt(f.value)) : f.value
  }
  const lines = [`${EMOJI[alert.level]} *${alert.title}* (Waybill ${context.network})`, alert.note ?? alert.detail]
  for (const f of alert.fields ?? []) lines.push(`• ${f.name}: ${value(f)}`)
  if (alert.txHash) {
    const url = link(context.explorerUrl, 'tx', alert.txHash)
    lines.push(url ? `<${url}|View transaction>` : `Transaction ${alert.txHash}`)
  }
  return lines.join('\n')
}
