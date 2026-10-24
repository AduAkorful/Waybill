import { describe, expect, test } from 'bun:test'
import { ContactsError, emailMessage, readEmailSettings, saveEmailSettings, verifyEmailToken } from './contacts'

describe('email message', () => {
  test('is exactly the text the relayer verifies', () => {
    expect(emailMessage({ network: 'testnet', chainId: 5042002, wallet: `0x${'AB'.repeat(20)}`, action: 'set', email: 'Me@Example.com', notify: true, signedAt: 1_800_000_000 })).toBe(
      ['Waybill email settings', 'action: set', 'network: testnet', 'chain: 5042002', `wallet: 0x${'ab'.repeat(20)}`, 'email: me@example.com', 'notify: yes', 'signed: 1800000000'].join('\n'),
    )
  })
})

describe('email settings client', () => {
  process.env.NEXT_PUBLIC_WAYBILL_API_BASE_URL = 'http://localhost:3001'
  process.env.NEXT_PUBLIC_WAYBILL_NETWORK = 'testnet'
  const sign = async () => '0xsig' as `0x${string}`
  const reply = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch

  test('saves with one signature over the lower-cased address', async () => {
    let signed = ''
    let sent: RequestInit | null = null
    const result = await saveEmailSettings({
      wallet: '0xabc', email: ' Me@Example.com ', notify: true, now: () => 1_800_000_000,
      sign: async (m) => ((signed = m), '0xsig' as `0x${string}`),
      fetcher: (async (_u: string, init: RequestInit) => ((sent = init), new Response(JSON.stringify({ email: 'me@example.com', notificationsEnabled: true, verified: false })))) as unknown as typeof fetch,
    })
    expect(result.verified).toBe(false)
    expect(signed).toContain('email: me@example.com')
    expect(JSON.parse(String(sent!.body))).toEqual({ email: 'me@example.com', notify: true })
  })
  test('reads null when nothing is set, and says why a request failed', async () => {
    expect(await readEmailSettings({ wallet: '0xabc', sign, fetcher: reply(404, { error: 'no_email_set' }) })).toBeNull()
    await expect(saveEmailSettings({ wallet: '0xabc', email: 'x@y.co', notify: true, sign, fetcher: reply(503, { error: 'email_unavailable' }) })).rejects.toThrow('not switched on')
    await expect(verifyEmailToken('t'.repeat(30), reply(404, { error: 'link_expired_or_used' }))).rejects.toBeInstanceOf(ContactsError)
  })
})
