import type { WaybillNetwork } from '@waybill/network/networks'

export type AlertLevel = 'critical' | 'warning' | 'info'

export interface Alert {
  /** Stable identity: an event's tx and log index, or a watch condition's name */
  key: string
  level: AlertLevel
  title: string
  detail: string
}

export interface AlertSink {
  readonly name: string
  send(alert: Alert, network: WaybillNetwork): Promise<void>
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

/**
 * On-chain events worth waking someone for. Every pauser power shows up here (pause, caps, treasury, fee range,
 * arbiter list, registry writers), so a stolen pauser key cannot act unseen; so do payouts and refunds that failed.
 */
const EVENT_ALERTS: Record<string, { level: AlertLevel; title: string }> = {
  PayoutFailed: { level: 'critical', title: 'A payout to a supplier failed' },
  RefundFailed: { level: 'critical', title: 'A refund to a buyer failed' },
  WriterAdded: { level: 'critical', title: 'The pauser added an attestor-registry writer' },
  WriterRemoved: { level: 'critical', title: 'The pauser removed an attestor-registry writer' },
  NewDealsPaused: { level: 'warning', title: 'New deals were paused' },
  NewDealsUnpaused: { level: 'warning', title: 'New deals were resumed' },
  CapsLowered: { level: 'warning', title: 'The deal limits were lowered' },
  CapsRaiseScheduled: { level: 'warning', title: 'Higher deal limits were scheduled' },
  CapsRaised: { level: 'warning', title: 'The deal limits were raised' },
  SetTreasuryScheduled: { level: 'warning', title: 'A treasury change was scheduled' },
  SetTreasuryExecuted: { level: 'warning', title: 'The treasury changed' },
  SetFeeBpsRangeScheduled: { level: 'warning', title: 'A fee range change was scheduled' },
  SetFeeBpsRangeExecuted: { level: 'warning', title: 'The fee range changed' },
  AddArbiterScheduled: { level: 'warning', title: 'An arbiter addition was scheduled' },
  RemoveArbiterScheduled: { level: 'warning', title: 'An arbiter removal was scheduled' },
  AddArbiterExecuted: { level: 'warning', title: 'An arbiter was added to the list' },
  RemoveArbiterExecuted: { level: 'warning', title: 'An arbiter was removed from the list' },
}

export const ALERT_EVENT_NAMES = Object.keys(EVENT_ALERTS)

const plain = (value: unknown): string =>
  JSON.stringify(value, (_key, v: unknown) => (typeof v === 'bigint' ? v.toString() : v))

/** The alert a newly indexed event raises, or null when it is not alert-worthy or is old history. */
export function alertForEvent(event: AlertableEvent, isNew: boolean, nowSeconds: number): Alert | null {
  const spec = EVENT_ALERTS[event.eventName]
  if (!spec || !isNew) return null
  // without a block time we cannot tell news from history; a missed alert is safer than a flood on backfill
  if (event.blockTimestamp === undefined || nowSeconds - Number(event.blockTimestamp) > MAX_ALERT_AGE_SECONDS) return null
  const where = [
    event.dealId === undefined ? null : `deal ${event.dealId}`,
    event.milestoneIndex === undefined ? null : `part ${event.milestoneIndex + 1}`,
  ].filter(Boolean)
  return {
    key: `${event.transactionHash}:${event.logIndex}`,
    level: spec.level,
    title: where.length > 0 ? `${spec.title} (${where.join(', ')})` : spec.title,
    detail: `${event.eventName} ${plain(event.payload)}\ntx ${event.transactionHash}`,
  }
}

export interface WatchReading {
  /** Relayer gas balance in native units (18 decimals) */
  relayerGas: bigint
  currentLocked: bigint
  maxLocked: bigint
  head: bigint
  cursors: { stream: string; block: bigint }[]
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

const usdc18 = (units: bigint) => {
  const whole = units / 10n ** 18n
  const cents = (units % 10n ** 18n) / 10n ** 16n
  return `${whole}.${cents.toString().padStart(2, '0')}`
}
const usdc6 = (units: bigint) => `${units / 1_000_000n}.${((units % 1_000_000n) / 10_000n).toString().padStart(2, '0')}`

/** Every watch condition that is currently bad, keyed by condition. */
export function evaluateWatch(reading: WatchReading, limits: WatchThresholds): Alert[] {
  const alerts: Alert[] = []
  if (reading.relayerGas < limits.minRelayerGas) {
    alerts.push({
      key: 'relayer-gas-low',
      level: 'critical',
      title: 'The relayer is low on gas',
      detail: `Gas balance ${usdc18(reading.relayerGas)} USDC, alert below ${usdc18(limits.minRelayerGas)}. Claims and refunds stop being sent when it runs out (parties can still send them).`,
    })
  }
  for (const stream of limits.streams) {
    const cursor = reading.cursors.find((c) => c.stream === stream)
    const lag = cursor ? (reading.head > cursor.block ? reading.head - cursor.block : 0n) : null
    if (lag === null || lag > limits.maxLagBlocks) {
      alerts.push({
        key: `lag-${stream}`,
        level: 'warning',
        title: `The ${stream} loop is behind the chain`,
        detail: lag === null ? `No cursor recorded for ${stream}.` : `${lag} blocks behind (head ${reading.head}), alert above ${limits.maxLagBlocks}.`,
      })
    }
  }
  if (reading.maxLocked > 0n && reading.currentLocked * 100n >= reading.maxLocked * BigInt(limits.lockedPercent)) {
    alerts.push({
      key: 'locked-near-cap',
      level: 'warning',
      title: 'Money held is close to the total limit',
      detail: `${usdc6(reading.currentLocked)} of ${usdc6(reading.maxLocked)} USDC held (alert at ${limits.lockedPercent}%). New deals will be refused at the limit.`,
    })
  }
  return alerts
}

export interface AlertMonitorDeps {
  network: WaybillNetwork
  sinks: readonly AlertSink[]
  thresholds: WatchThresholds
  read(): Promise<WatchReading>
  /** Repeat a still-bad condition this often */
  remindEverySeconds?: number
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

  constructor(private readonly deps: AlertMonitorDeps) {}

  private now(): number {
    return (this.deps.now ?? (() => Math.floor(Date.now() / 1000)))()
  }

  async handleEvent(event: AlertableEvent, isNew: boolean): Promise<void> {
    const alert = alertForEvent(event, isNew, this.now())
    if (alert) await this.deliver(alert)
  }

  async pollOnce(): Promise<void> {
    let current: Alert[]
    try {
      current = evaluateWatch(await this.deps.read(), this.deps.thresholds)
    } catch (error) {
      current = [{ key: 'watch-read-failed', level: 'warning', title: 'The alert monitor cannot read the chain or database', detail: error instanceof Error ? error.message : String(error) }]
    }
    const now = this.now()
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
      await this.deliver({ key, level: 'info', title: `Resolved: ${alert.title}`, detail: 'The condition has cleared.' })
    }
  }

  private async deliver(alert: Alert): Promise<void> {
    ;(this.deps.log ?? ((line) => console.warn(line)))(`[waybill-alert] ${alert.level} ${alert.title} | ${alert.detail.replace(/\n/g, ' | ')}`)
    for (const sink of this.deps.sinks) {
      try {
        await sink.send(alert, this.deps.network)
      } catch (error) {
        ;(this.deps.reportError ?? ((e) => console.error('[waybill-alert]', sink.name, e)))(error)
      }
    }
  }
}

const subject = (alert: Alert, network: WaybillNetwork) => `[Waybill ${network}] ${alert.level.toUpperCase()}: ${alert.title}`

/** Posts each alert as JSON. `text` suits Slack-style hooks and `content` Discord-style ones. */
export class WebhookAlertSink implements AlertSink {
  readonly name = 'webhook'
  constructor(
    private readonly url: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async send(alert: Alert, network: WaybillNetwork): Promise<void> {
    const text = `${subject(alert, network)}\n${alert.detail}`
    const response = await this.fetcher(this.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, content: text, network, level: alert.level, key: alert.key, title: alert.title, detail: alert.detail }),
    })
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

  async send(alert: Alert, network: WaybillNetwork): Promise<void> {
    const response = await this.fetcher(this.options.endpoint ?? 'https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.options.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: this.options.from, to: [this.options.to], subject: subject(alert, network), text: alert.detail }),
    })
    if (!response.ok) throw new Error(`Email provider refused the alert (${response.status})`)
  }
}
