import type { WaybillNetwork } from '@waybill/network/networks'
import { discordMessage, eventFields, plainDetail, slackText, usdc, type AlertContext } from './alert-format'

export type AlertLevel = 'critical' | 'warning' | 'info'

/** One labelled value. `address` and `time` (unix seconds) are rendered as explorer links and dates by each sink. */
export interface AlertField {
  name: string
  value: string
  kind?: 'address' | 'time'
}

export interface Alert {
  /** Stable identity: an event's tx and log index, or a watch condition's name */
  key: string
  level: AlertLevel
  title: string
  /** Plain text for logs and email */
  detail: string
  /** One or two sentences: what happened and what to do about it */
  note?: string
  fields?: AlertField[]
  txHash?: string
}

export interface AlertSink {
  readonly name: string
  send(alert: Alert, context: AlertContext): Promise<void>
}

export interface AlertableEvent {
  eventName: string
  dealId?: bigint
  milestoneIndex?: number
  blockTimestamp?: bigint
  transactionHash: string
  logIndex: bigint
  payload: Record<string, unknown>
}

/** Events older than this are history being re-read (a backfill), not news, and raise no alert. */
export const MAX_ALERT_AGE_SECONDS = 48 * 3_600

const NOT_YOU = 'If you did not do this, the pauser key may be compromised: pause new deals and move funds you control.'

/**
 * On-chain events worth waking someone for. Every pauser power shows up here (pause, caps, treasury, fee range,
 * arbiter list, registry writers), so a stolen pauser key cannot act unseen; so do payouts and refunds that failed.
 */
const EVENT_ALERTS: Record<string, { level: AlertLevel; title: string; note: string }> = {
  PayoutFailed: { level: 'critical', title: 'A payout to a supplier failed', note: 'The USDC transfer to the supplier was refused, so the part stays payable. Anyone can retry the payout; check the recipient address.' },
  RefundFailed: { level: 'critical', title: 'A refund to a buyer failed', note: 'The USDC transfer to the buyer was refused, so the refund stays owed. Anyone can retry it; check the recipient address.' },
  WriterAdded: { level: 'critical', title: 'Attestor-registry writer added', note: `This contract can now record attestor outcomes. Expected only during a deployment. ${NOT_YOU}` },
  WriterRemoved: { level: 'critical', title: 'Attestor-registry writer removed', note: `This contract can no longer record attestor outcomes. ${NOT_YOU}` },
  NewDealsPaused: { level: 'warning', title: 'New deals paused', note: 'No new deal can be created or funded. Claims, refunds, disputes and decisions on existing deals carry on.' },
  NewDealsUnpaused: { level: 'warning', title: 'New deals resumed', note: 'Deals can be created and funded again.' },
  CapsLowered: { level: 'warning', title: 'Deal limits lowered', note: `In force now; any scheduled raise is cancelled. Deals already funded are unaffected. ${NOT_YOU}` },
  CapsRaiseScheduled: { level: 'warning', title: 'Higher deal limits scheduled', note: `They can be applied after the 48-hour delay. ${NOT_YOU}` },
  CapsRaised: { level: 'warning', title: 'Deal limits raised', note: `The scheduled limits are now in force. ${NOT_YOU}` },
  SetTreasuryScheduled: { level: 'warning', title: 'Treasury change scheduled', note: `Protocol fees will go to the proposed address once the delay ends. ${NOT_YOU}` },
  SetTreasuryExecuted: { level: 'warning', title: 'Treasury changed', note: `New deals send protocol fees to the new address. ${NOT_YOU}` },
  SetFeeBpsRangeScheduled: { level: 'warning', title: 'Fee range change scheduled', note: `Applies to new deals once the delay ends. ${NOT_YOU}` },
  SetFeeBpsRangeExecuted: { level: 'warning', title: 'Fee range changed', note: `Applies to new deals from now on. ${NOT_YOU}` },
  AddArbiterScheduled: { level: 'warning', title: 'Arbiter addition scheduled', note: `This address can be named as an arbiter on new deals once the delay ends. ${NOT_YOU}` },
  RemoveArbiterScheduled: { level: 'warning', title: 'Arbiter removal scheduled', note: 'Once the delay ends, new deals can no longer name this arbiter. Existing deals keep it.' },
  AddArbiterExecuted: { level: 'warning', title: 'Arbiter added to the list', note: `New deals can now name this arbiter. ${NOT_YOU}` },
  RemoveArbiterExecuted: { level: 'warning', title: 'Arbiter removed from the list', note: 'New deals can no longer name this arbiter. Existing deals keep it.' },
}

export const ALERT_EVENT_NAMES = Object.keys(EVENT_ALERTS)

/** The alert a newly indexed event raises, or null when it is not alert-worthy or is old history. */
export function alertForEvent(event: AlertableEvent, isNew: boolean, nowSeconds: number, explorerUrl?: string): Alert | null {
  const spec = EVENT_ALERTS[event.eventName]
  if (!spec || !isNew) return null
  // without a block time we cannot tell news from history; a missed alert is safer than a flood on backfill
  if (event.blockTimestamp === undefined || nowSeconds - Number(event.blockTimestamp) > MAX_ALERT_AGE_SECONDS) return null
  const where = [
    event.dealId === undefined ? null : `deal ${event.dealId}`,
    event.milestoneIndex === undefined ? null : `part ${event.milestoneIndex + 1}`,
  ].filter(Boolean)
  const body = { note: spec.note, fields: eventFields(event), txHash: event.transactionHash }
  return {
    key: `${event.transactionHash}:${event.logIndex}`,
    level: spec.level,
    title: where.length > 0 ? `${spec.title} (${where.join(', ')})` : spec.title,
    detail: plainDetail(body, explorerUrl),
    ...body,
  }
}

export interface WatchReading {
  /** Relayer gas balance in native units (18 decimals) */
  relayerGas: bigint
  currentLocked: bigint
  maxLocked: bigint
  head: bigint
  cursors: { stream: string; block: bigint }[]
  /** The relayer's gas wallet, shown so the alert says what to fund */
  relayerAddress?: string
}

export interface WatchThresholds {
  /** Native units (18 decimals) */
  minRelayerGas: bigint
  maxLagBlocks: bigint
  /** Warn when currentLocked reaches this percentage of maxLocked */
  lockedPercent: number
  /** Streams that must have a cursor; a missing one means that loop never ran */
  streams: readonly string[]
}

// native gas has 18 decimals; shown to the cent like the token
const usdc18 = (units: bigint) => usdc(units / 10n ** 12n)

function watchAlert(key: string, level: AlertLevel, title: string, note: string, fields: AlertField[]): Alert {
  return { key, level, title, note, fields, detail: plainDetail({ note, fields }) }
}

/** Every watch condition that is currently bad, keyed by condition. */
export function evaluateWatch(reading: WatchReading, limits: WatchThresholds): Alert[] {
  const alerts: Alert[] = []
  if (reading.relayerGas < limits.minRelayerGas) {
    alerts.push(
      watchAlert('relayer-gas-low', 'critical', 'Relayer is low on gas', 'Send USDC to the relayer wallet. When it runs out, claims and refunds stop being sent for people (they can still send them themselves).', [
        ...(reading.relayerAddress ? [{ name: 'Relayer wallet', value: reading.relayerAddress, kind: 'address' as const }] : []),
        { name: 'Balance', value: usdc18(reading.relayerGas) },
        { name: 'Alert below', value: usdc18(limits.minRelayerGas) },
      ]),
    )
  }
  for (const stream of limits.streams) {
    const cursor = reading.cursors.find((c) => c.stream === stream)
    const lag = cursor ? (reading.head > cursor.block ? reading.head - cursor.block : 0n) : null
    if (lag === null || lag > limits.maxLagBlocks) {
      alerts.push(
        watchAlert(`lag-${stream}`, 'warning', `${stream} is behind the chain`, lag === null ? 'This loop has not recorded any progress. Check the relayer logs.' : 'It is catching up or stuck. If the gap keeps growing, check the relayer logs and the RPC.', [
          { name: 'Behind', value: lag === null ? 'no progress recorded' : `${lag} blocks` },
          { name: 'Chain head', value: reading.head.toString() },
          { name: 'Alert above', value: `${limits.maxLagBlocks} blocks` },
        ]),
      )
    }
  }
  if (reading.maxLocked > 0n && reading.currentLocked * 100n >= reading.maxLocked * BigInt(limits.lockedPercent)) {
    alerts.push(
      watchAlert('locked-near-cap', 'warning', 'Money held is close to the total limit', 'New deals will be refused once the limit is reached. Schedule a raise if that is intended.', [
        { name: 'Held', value: usdc(reading.currentLocked) },
        { name: 'Total limit', value: usdc(reading.maxLocked) },
        { name: 'Alert at', value: `${limits.lockedPercent}%` },
      ]),
    )
  }
  return alerts
}

export interface AlertMonitorDeps {
  network: WaybillNetwork
  explorerUrl?: string
  sinks: readonly AlertSink[]
  thresholds: WatchThresholds
  read(): Promise<WatchReading>
  /** Repeat a still-bad condition this often */
  remindEverySeconds?: number
  /** After a start, lag is expected while the loops catch up; lag alerts wait this long */
  startupGraceSeconds?: number
  now?: () => number
  log?: (line: string) => void
  reportError?: (error: unknown) => void
}

/**
 * Raises alerts from indexed events and from a periodic look at the relayer's gas, the loops' lag and the cap. A
 * watch condition alerts when it starts, again every few hours while it lasts, and once more when it clears. Delivery
 * failures are reported and never stop the relayer.
 */
export class AlertMonitor {
  private readonly active = new Map<string, { alert: Alert; lastSent: number }>()
  private readonly startedAt: number

  constructor(private readonly deps: AlertMonitorDeps) {
    this.startedAt = this.now()
  }

  private now(): number {
    return (this.deps.now ?? (() => Math.floor(Date.now() / 1000)))()
  }

  async handleEvent(event: AlertableEvent, isNew: boolean): Promise<void> {
    const alert = alertForEvent(event, isNew, this.now(), this.deps.explorerUrl)
    if (alert) await this.deliver(alert)
  }

  async pollOnce(): Promise<void> {
    const now = this.now()
    const settling = now - this.startedAt < (this.deps.startupGraceSeconds ?? 600)
    let current: Alert[]
    try {
      current = evaluateWatch(await this.deps.read(), this.deps.thresholds).filter((a) => !(settling && a.key.startsWith('lag-')))
    } catch (error) {
      const note = error instanceof Error ? error.message : String(error)
      current = [{ key: 'watch-read-failed', level: 'warning', title: 'Alert monitor cannot read the chain or database', note, detail: note }]
    }
    const remind = this.deps.remindEverySeconds ?? 6 * 3_600
    const seen = new Set<string>()
    for (const alert of current) {
      seen.add(alert.key)
      const before = this.active.get(alert.key)
      if (!before) {
        this.active.set(alert.key, { alert, lastSent: now })
        await this.deliver(alert)
      } else if (now - before.lastSent >= remind) {
        before.lastSent = now
        await this.deliver({ ...alert, title: `Still: ${alert.title}` })
      }
    }
    for (const [key, { alert }] of [...this.active]) {
      if (seen.has(key)) continue
      this.active.delete(key)
      await this.deliver({ key, level: 'info', title: `Resolved: ${alert.title}`, note: 'The condition has cleared.', detail: 'The condition has cleared.' })
    }
  }

  private async deliver(alert: Alert): Promise<void> {
    ;(this.deps.log ?? ((line) => console.warn(line)))(`[waybill-alert] ${alert.level} ${alert.title} | ${alert.detail.replace(/\n/g, ' | ')}`)
    const context: AlertContext = { network: this.deps.network, explorerUrl: this.deps.explorerUrl }
    for (const sink of this.deps.sinks) {
      try {
        await sink.send(alert, context)
      } catch (error) {
        ;(this.deps.reportError ?? ((e) => console.error('[waybill-alert]', sink.name, e)))(error)
      }
    }
  }
}

const subject = (alert: Alert, network: WaybillNetwork) => `[Waybill ${network}] ${alert.level.toUpperCase()}: ${alert.title}`
const isDiscord = (url: string) => /^(canary\.|ptb\.)?discord(app)?\.com$/.test(new URL(url).hostname)
const isSlack = (url: string) => new URL(url).hostname === 'hooks.slack.com'

/**
 * Posts each alert to a webhook. Discord gets an embed, Slack a formatted message; any other endpoint gets JSON with
 * the plain text in `text` and `content` plus the alert's own fields.
 */
export class WebhookAlertSink implements AlertSink {
  readonly name = 'webhook'
  constructor(
    private readonly url: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async send(alert: Alert, context: AlertContext): Promise<void> {
    const text = `${subject(alert, context.network)}\n${plainDetail(alert, context.explorerUrl) || alert.detail}`
    const body = isDiscord(this.url)
      ? discordMessage(alert, context)
      : isSlack(this.url)
        ? { text: slackText(alert, context) }
        : { text, content: text, network: context.network, level: alert.level, key: alert.key, title: alert.title, detail: alert.detail }
    const response = await this.fetcher(this.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    if (!response.ok) throw new Error(`Alert webhook refused the alert (${response.status})`)
  }
}

/** Sends each alert straight to the operator through Resend; alerts never go through the user-facing outbox. */
export class EmailAlertSink implements AlertSink {
  readonly name = 'email'
  constructor(
    private readonly options: { apiKey: string; from: string; to: string; endpoint?: string },
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async send(alert: Alert, context: AlertContext): Promise<void> {
    const response = await this.fetcher(this.options.endpoint ?? 'https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.options.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: this.options.from, to: [this.options.to], subject: subject(alert, context.network), text: plainDetail(alert, context.explorerUrl) || alert.detail }),
    })
    if (!response.ok) throw new Error(`Email provider refused the alert (${response.status})`)
  }
}
