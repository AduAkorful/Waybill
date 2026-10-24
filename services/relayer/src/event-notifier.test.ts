import { describe, expect, test } from 'bun:test'
import { loadEmailSetup } from './email-config'
import { EventNotifier, MAX_NEWS_AGE_SECONDS, type NotifiableEvent } from './event-notifier'
import { ResendEmailProvider } from './email-resend'
import type { NotificationInput } from './notification-outbox'

const A = (n: number) => `0x${n.toString(16).padStart(40, '0')}`
const NOW = 1_800_000_000
const parties = async () => [
  { address: A(1), role: 'buyer' as const, milestoneIndex: null },
  { address: A(2), role: 'supplier' as const, milestoneIndex: null },
]
const emails: Record<string, string> = { [A(1)]: 'buyer@example.com' }

function setup() {
  const queued: NotificationInput[] = []
  const notifier = new EventNotifier({
    network: 'testnet',
    parties,
    recipient: async (w) => emails[w] ?? null,
    enqueue: async (i) => void queued.push(i),
    now: () => NOW,
  })
  return { queued, notifier }
}
const event = (over: Partial<NotifiableEvent> = {}): NotifiableEvent => ({ eventName: 'SupplierAccepted', dealId: 7n, blockTimestamp: BigInt(NOW - 60), transactionHash: '0xaa', logIndex: 1n, payload: {}, ...over })

describe('event notifier', () => {
  test('queues one email per person who has a verified address, and skips the rest', async () => {
    const { notifier, queued } = setup()
    expect(await notifier.handle(event({ eventName: 'DealSettled' }), true)).toBe(1)
    expect(queued).toHaveLength(1)
    expect(queued[0]).toMatchObject({ recipient: 'buyer@example.com', template: 'settled', channel: 'email', payload: { deal: '7', role: 'buyer' } })
  })
  test('says nothing about events already seen, or old ones being re-read, or ones with no block time', async () => {
    const { notifier } = setup()
    expect(await notifier.handle(event(), false)).toBe(0)
    expect(await notifier.handle(event({ blockTimestamp: BigInt(NOW - MAX_NEWS_AGE_SECONDS - 1) }), true)).toBe(0)
    expect(await notifier.handle(event({ blockTimestamp: undefined }), true)).toBe(0)
  })
})

describe('email provider', () => {
  const delivery = { to: 'a@example.com', template: 'funded', payload: { deal: '7', role: 'supplier' } }
  test('posts the rendered mail to the provider with the key', async () => {
    let seen: { init: RequestInit } | null = null
    const provider = new ResendEmailProvider({ apiKey: 'k', from: 'Waybill <n@x.test>', webUrl: 'https://app.example' }, (async (_u: string, init: RequestInit) => ((seen = { init }), new Response('{}'))) as unknown as typeof fetch)
    await provider.send(delivery)
    expect((seen!.init.headers as Record<string, string>).authorization).toBe('Bearer k')
    expect(JSON.parse(String(seen!.init.body))).toMatchObject({ to: ['a@example.com'], subject: 'Deal 7 is funded' })
  })
  test('throws when refused or when the template is unknown, so the outbox retries or the bug shows', async () => {
    const refuse = new ResendEmailProvider({ apiKey: 'k', from: 'f', webUrl: 'https://x' }, (async () => new Response('no', { status: 500 })) as unknown as typeof fetch)
    await expect(refuse.send(delivery)).rejects.toThrow('refused')
    await expect(refuse.send({ ...delivery, template: 'nope' })).rejects.toThrow('No email is defined')
  })
})

describe('email setup', () => {
  test('all or nothing', () => {
    expect(loadEmailSetup({})).toBeNull()
    expect(() => loadEmailSetup({ WAYBILL_EMAIL_FROM: 'x' })).toThrow('partly configured')
    expect(() => loadEmailSetup({ WAYBILL_EMAIL_RESEND_API_KEY: 'k', WAYBILL_EMAIL_FROM: 'f', WAYBILL_PUBLIC_WEB_URL: 'ftp://x' })).toThrow('http(s)')
    expect(loadEmailSetup({ WAYBILL_EMAIL_RESEND_API_KEY: 'k', WAYBILL_EMAIL_FROM: 'f', WAYBILL_PUBLIC_WEB_URL: 'https://app.example/' })!.webUrl).toBe('https://app.example')
  })
})
