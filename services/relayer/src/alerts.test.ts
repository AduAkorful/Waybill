import { describe, expect, test } from 'bun:test'

import { loadAlertConfig } from './alert-config'
import { discordMessage, slackText, usdc } from './alert-format'
import { AlertMonitor, WebhookAlertSink, alertForEvent, evaluateWatch, type Alert, type AlertSink, type WatchReading } from './alerts'

const NOW = 1_800_000_000
const event = (eventName: string, overrides: Record<string, unknown> = {}) => ({
  eventName,
  blockTimestamp: BigInt(NOW - 60),
  transactionHash: '0xabc',
  logIndex: 3n,
  payload: { maxDealAmount: 5_000_000_000n },
  ...overrides,
})

const LIMITS = { minRelayerGas: 5n * 10n ** 18n, maxLagBlocks: 100n, lockedPercent: 80, streams: ['escrow-indexer', 'escrow-relayer'] }
const HEALTHY: WatchReading = {
  relayerGas: 10n * 10n ** 18n,
  currentLocked: 1_000_000n,
  maxLocked: 10_000_000n,
  head: 1_000n,
  cursors: [
    { stream: 'escrow-indexer', block: 990n },
    { stream: 'escrow-relayer', block: 995n },
  ],
}

class RecordingSink implements AlertSink {
  readonly name = 'recording'
  sent: Alert[] = []
  async send(alert: Alert) {
    this.sent.push(alert)
  }
}

describe('alertForEvent', () => {
  test('raises an alert for every pauser power and for failed payouts', () => {
    for (const name of ['CapsRaiseScheduled', 'NewDealsPaused', 'SetTreasuryScheduled', 'AddArbiterScheduled', 'WriterAdded', 'PayoutFailed', 'RefundFailed']) {
      expect(alertForEvent(event(name), true, NOW)).not.toBeNull()
    }
  })

  test('says where it happened and keeps bigint arguments readable', () => {
    const alert = alertForEvent(event('PayoutFailed', { dealId: 7n, milestoneIndex: 1 }), true, NOW)!
    expect(alert.level).toBe('critical')
    expect(alert.title).toBe('A payout to a supplier failed (deal 7, part 2)')
    expect(alert.detail).toContain('Largest single deal: 5,000.00 USDC')
    expect(alert.fields).toContainEqual({ name: 'Deal', value: '7' })
    expect(alert.key).toBe('0xabc:3')
  })

  test('ignores ordinary events, repeats, old history and events without a block time', () => {
    expect(alertForEvent(event('DealFunded'), true, NOW)).toBeNull()
    expect(alertForEvent(event('PayoutFailed'), false, NOW)).toBeNull()
    expect(alertForEvent(event('PayoutFailed', { blockTimestamp: BigInt(NOW - 49 * 3600) }), true, NOW)).toBeNull()
    expect(alertForEvent(event('PayoutFailed', { blockTimestamp: undefined }), true, NOW)).toBeNull()
  })
})

describe('evaluateWatch', () => {
  test('a healthy reading raises nothing', () => {
    expect(evaluateWatch(HEALTHY, LIMITS)).toEqual([])
  })

  test('low gas, a lagging or missing loop and a nearly full cap each raise one alert', () => {
    const keys = evaluateWatch(
      { ...HEALTHY, relayerGas: 1n, currentLocked: 8_000_000n, cursors: [{ stream: 'escrow-indexer', block: 500n }] },
      LIMITS,
    ).map((a) => a.key)
    expect(keys).toEqual(['relayer-gas-low', 'lag-escrow-indexer', 'lag-escrow-relayer', 'locked-near-cap'])
  })

  test('formats gas in 18 decimals and money held in 6', () => {
    const [gas, , , held] = evaluateWatch({ ...HEALTHY, relayerGas: 1_500_000_000_000_000_000n, currentLocked: 9_000_000n, cursors: [] }, LIMITS)
    expect(gas!.detail).toContain('1.50 USDC')
    expect(held!.detail).toContain('Held: 9.00 USDC')
    expect(held!.detail).toContain('Total limit: 10.00 USDC')
  })
})

describe('AlertMonitor', () => {
  const monitor = (sink: AlertSink, read: () => Promise<WatchReading>, clock: { t: number }) =>
    new AlertMonitor({ network: 'mainnet', sinks: [sink], thresholds: LIMITS, read, now: () => clock.t, remindEverySeconds: 3_600, log: () => {} })

  test('alerts when a condition starts, reminds while it lasts, and says when it clears', async () => {
    const sink = new RecordingSink()
    const clock = { t: NOW }
    let reading: WatchReading = { ...HEALTHY, relayerGas: 1n }
    const m = monitor(sink, async () => reading, clock)

    await m.pollOnce()
    await m.pollOnce()
    expect(sink.sent.map((a) => a.title)).toEqual(['Relayer is low on gas'])

    clock.t += 3_600
    await m.pollOnce()
    expect(sink.sent.at(-1)!.title).toBe('Still: Relayer is low on gas')

    reading = HEALTHY
    await m.pollOnce()
    expect(sink.sent.at(-1)!.title).toBe('Resolved: Relayer is low on gas')
    await m.pollOnce()
    expect(sink.sent).toHaveLength(3)
  })

  test('a failed read is itself an alert', async () => {
    const sink = new RecordingSink()
    await monitor(sink, async () => { throw new Error('rpc down') }, { t: NOW }).pollOnce()
    expect(sink.sent[0]!.key).toBe('watch-read-failed')
    expect(sink.sent[0]!.detail).toBe('rpc down')
  })

  test('a failing destination does not stop the others', async () => {
    const good = new RecordingSink()
    const bad: AlertSink = { name: 'bad', send: async () => { throw new Error('nope') } }
    const errors: unknown[] = []
    const m = new AlertMonitor({ network: 'mainnet', sinks: [bad, good], thresholds: LIMITS, read: async () => HEALTHY, now: () => NOW, log: () => {}, reportError: (e) => errors.push(e) })
    await m.handleEvent(event('NewDealsPaused'), true)
    expect(good.sent).toHaveLength(1)
    expect(errors).toHaveLength(1)
  })
})

describe('loadAlertConfig', () => {
  const calls: { url: string; body: string }[] = []
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: String(init.body) })
    return new Response('{}', { status: 200 })
  }) as unknown as typeof fetch

  test('mainnet refuses to start with nowhere to send alerts; testnet only logs', () => {
    expect(() => loadAlertConfig({}, 'mainnet')).toThrow('Mainnet needs WAYBILL_ALERT_WEBHOOK_URL or WAYBILL_ALERT_EMAIL')
    expect(loadAlertConfig({}, 'testnet').sinks).toHaveLength(0)
  })

  test('defaults: 5 USDC of gas (18 decimals), 1200 blocks of lag, 80% of the cap, every 60 s', () => {
    const config = loadAlertConfig({ WAYBILL_ALERT_WEBHOOK_URL: 'https://hooks.example/x' }, 'mainnet')
    expect(config.minRelayerGas).toBe(5n * 10n ** 18n)
    expect(config.maxLagBlocks).toBe(1_200n)
    expect(config.lockedPercent).toBe(80)
    expect(config.pollIntervalMs).toBe(60_000)
  })

  test('refuses an http webhook, a malformed threshold and email without a provider', () => {
    expect(() => loadAlertConfig({ WAYBILL_ALERT_WEBHOOK_URL: 'http://hooks.example/x' }, 'testnet')).toThrow('https')
    expect(() => loadAlertConfig({ WAYBILL_ALERT_MIN_GAS_USDC: 'five' }, 'testnet')).toThrow('WAYBILL_ALERT_MIN_GAS_USDC')
    expect(() => loadAlertConfig({ WAYBILL_ALERT_LOCKED_PERCENT: '150' }, 'testnet')).toThrow('WAYBILL_ALERT_LOCKED_PERCENT')
    expect(() => loadAlertConfig({ WAYBILL_ALERT_EMAIL: 'ops@example.com' }, 'mainnet')).toThrow('WAYBILL_EMAIL_RESEND_API_KEY')
  })

  test('webhook and email destinations send the alert', async () => {
    const config = loadAlertConfig(
      { WAYBILL_ALERT_WEBHOOK_URL: 'https://hooks.example/x', WAYBILL_ALERT_EMAIL: 'ops@example.com', WAYBILL_EMAIL_RESEND_API_KEY: 're_test', WAYBILL_EMAIL_FROM: 'Waybill <a@example.com>' },
      'mainnet',
      fetcher,
    )
    const alert: Alert = { key: 'k', level: 'critical', title: 'A payout to a supplier failed', detail: 'tx 0xabc' }
    for (const sink of config.sinks) await sink.send(alert, { network: 'mainnet' })
    expect(calls[0]!.url).toBe('https://hooks.example/x')
    expect(JSON.parse(calls[0]!.body).text).toBe('[Waybill mainnet] CRITICAL: A payout to a supplier failed\ntx 0xabc')
    expect(calls[1]!.url).toBe('https://api.resend.com/emails')
    expect(JSON.parse(calls[1]!.body).to).toEqual(['ops@example.com'])
  })
})

describe('alert formatting', () => {
  const EXPLORER = 'https://explorer.arc.io'
  const writer = alertForEvent(
    event('WriterAdded', { payload: { writer: '0x8a13ff4FbfBd67cE10e1Fd015bD4a8De3179C5ff' }, transactionHash: '0xa60f3e8fe807bebbe57e947304f2cea6a7368e1b1c090b09b7f9b1f3668dc3d7' }),
    true,
    NOW,
    EXPLORER,
  )!

  test('usdc keeps sub-cent digits and groups thousands', () => {
    expect(usdc(1_000_000_000n)).toBe('1,000.00 USDC')
    expect(usdc(1_234_567n)).toBe('1.234567 USDC')
    expect(usdc(1_500_000n)).toBe('1.50 USDC')
  })

  test('events get a note, labelled fields and an explorer link in the plain text', () => {
    expect(writer.note).toContain('Expected only during a deployment')
    expect(writer.fields).toEqual([{ name: 'Writer', value: '0x8a13ff4FbfBd67cE10e1Fd015bD4a8De3179C5ff', kind: 'address' }])
    expect(writer.detail).toContain(`Transaction: ${EXPLORER}/tx/0xa60f`)
  })

  test('Discord gets one coloured embed with explorer links and local-time stamps', () => {
    const message = discordMessage(writer, { network: 'mainnet', explorerUrl: EXPLORER }, new Date(NOW * 1000))
    const embed = message.embeds[0]!
    expect(message.allowed_mentions).toEqual({ parse: [] })
    expect(embed.title).toBe('🔴 Attestor-registry writer added')
    expect(embed.color).toBe(0xe5484d)
    expect(embed.url).toBe(`${EXPLORER}/tx/0xa60f3e8fe807bebbe57e947304f2cea6a7368e1b1c090b09b7f9b1f3668dc3d7`)
    expect(embed.fields[0]).toEqual({ name: 'Writer', value: `[0x8a13…C5ff](${EXPLORER}/address/0x8a13ff4FbfBd67cE10e1Fd015bD4a8De3179C5ff)`, inline: true })
    expect(embed.fields.at(-1)!.name).toBe('Transaction')

    const eta = alertForEvent(event('CapsRaiseScheduled', { payload: { maxDealAmount: '5000000000', maxLocked: '50000000000', eta: '1800172800' } }), true, NOW)!
    const fields = discordMessage(eta, { network: 'mainnet' }).embeds[0]!.fields
    expect(fields.map((f) => f.value)).toEqual(['5,000.00 USDC', '50,000.00 USDC', '<t:1800172800:F> (<t:1800172800:R>)', '0xabc'])
  })

  test('Slack gets bullets and its own link syntax', () => {
    const text = slackText(writer, { network: 'mainnet', explorerUrl: EXPLORER })
    expect(text.split('\n')[0]).toBe('🔴 *Attestor-registry writer added* (Waybill mainnet)')
    expect(text).toContain(`• Writer: <${EXPLORER}/address/0x8a13ff4FbfBd67cE10e1Fd015bD4a8De3179C5ff|0x8a13…C5ff>`)
    expect(text).toContain('|View transaction>')
  })

  test('the webhook sink picks the format from the URL', async () => {
    const bodies: Record<string, unknown>[] = []
    const fetcher = (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)))
      return new Response('', { status: 204 })
    }) as unknown as typeof fetch
    await new WebhookAlertSink('https://discord.com/api/webhooks/1/x', fetcher).send(writer, { network: 'mainnet', explorerUrl: EXPLORER })
    await new WebhookAlertSink('https://hooks.slack.com/services/x', fetcher).send(writer, { network: 'mainnet', explorerUrl: EXPLORER })
    expect(Object.keys(bodies[0]!)).toEqual(['username', 'allowed_mentions', 'embeds'])
    expect(Object.keys(bodies[1]!)).toEqual(['text'])
  })
})

describe('AlertMonitor startup', () => {
  test('lag alerts wait out the startup grace; gas alerts do not', async () => {
    const sink = new RecordingSink()
    const clock = { t: NOW }
    const m = new AlertMonitor({ network: 'mainnet', sinks: [sink], thresholds: LIMITS, read: async () => ({ ...HEALTHY, relayerGas: 1n, cursors: [] }), now: () => clock.t, startupGraceSeconds: 600, log: () => {} })
    await m.pollOnce()
    expect(sink.sent.map((a) => a.key)).toEqual(['relayer-gas-low'])
    clock.t += 601
    await m.pollOnce()
    expect(sink.sent.map((a) => a.key)).toEqual(['relayer-gas-low', 'lag-escrow-indexer', 'lag-escrow-relayer'])
  })
})
