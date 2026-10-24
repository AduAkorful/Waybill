import { describe, expect, test } from 'bun:test'
import { privateKeyToAccount } from 'viem/accounts'
import { handleApiRequest, type WaybillApiOptions } from './api'
import { EmailError, PostgresWalletEmailStore, WalletEmailService, emailMessage } from './wallet-emails'

const me = privateKeyToAccount(`0x${'33'.repeat(32)}`)
const other = privateKeyToAccount(`0x${'44'.repeat(32)}`)
const context = { network: 'testnet', chainId: 5042002 }
const NOW = 1_800_000_000

function fakeStore() {
  const rows = new Map<string, { email: string; enabled: boolean; verified: boolean; token: string | null }>()
  return {
    rows,
    set: async (_n: 'testnet', wallet: string, email: string, enabled: boolean) => {
      const prev = rows.get(wallet.toLowerCase())
      const keep = prev?.email === email && prev.verified
      const token = keep ? null : `${'t'.repeat(24)}${rows.size}${email.length}`
      rows.set(wallet.toLowerCase(), { email, enabled, verified: keep, token })
      return token
    },
    get: async (_n: 'testnet', wallet: string) => {
      const r = rows.get(wallet.toLowerCase())
      return r ? { email: r.email, notificationsEnabled: r.enabled, verified: r.verified } : null
    },
    verify: async (_n: 'testnet', token: string) => {
      for (const [wallet, r] of rows) if (r.token === token) return (r.verified = true), (r.token = null), wallet
      return null
    },
  }
}

function setup() {
  const store = fakeStore()
  const sent: { to: string; token: string }[] = []
  const service = new WalletEmailService({
    context,
    network: 'testnet',
    store,
    sendVerification: async (to, token) => void sent.push({ to, token }),
    now: () => NOW,
  })
  return { service, store, sent }
}

async function signed(account: typeof me, action: 'set' | 'read', email = '', notify = false, signedAt = NOW) {
  return { wallet: account.address, signedAt, signature: await account.signMessage({ message: emailMessage(context, account.address, action, email, notify, signedAt) }) }
}

describe('email message', () => {
  test('is exactly this text (the web app asserts the same string)', () => {
    expect(emailMessage(context, `0x${'AB'.repeat(20)}`, 'set', 'Me@Example.com', true, 1_800_000_000)).toBe(
      ['Waybill email settings', 'action: set', 'network: testnet', 'chain: 5042002', `wallet: 0x${'ab'.repeat(20)}`, 'email: me@example.com', 'notify: yes', 'signed: 1800000000'].join('\n'),
    )
  })
})

describe('wallet email service', () => {
  test('a wallet can set its own email; a verification mail is sent and nothing is mailed until it is confirmed', async () => {
    const { service, sent } = setup()
    const result = await service.set(await signed(me, 'set', 'me@example.com', true), 'Me@Example.com', true)
    expect(result).toEqual({ email: 'me@example.com', notificationsEnabled: true, verified: false })
    expect(sent).toHaveLength(1)
    expect(sent[0]!.to).toBe('me@example.com')
  })
  test('the verification link works once; the same address is not asked again, a new one is', async () => {
    const { service, sent } = setup()
    await service.set(await signed(me, 'set', 'me@example.com', true), 'me@example.com', true)
    expect(await service.verify(`${sent[0]!.token}zz`)).toBe(false)
    expect(await service.verify(sent[0]!.token)).toBe(true)
    expect(await service.verify(sent[0]!.token)).toBe(false)
    const again = await service.set(await signed(me, 'set', 'me@example.com', false), 'me@example.com', false)
    expect(again).toMatchObject({ verified: true, notificationsEnabled: false })
    expect(sent).toHaveLength(1)
    await service.set(await signed(me, 'set', 'new@example.com', true), 'new@example.com', true)
    expect(sent).toHaveLength(2)
  })
  test('someone else’s signature, a changed address, an old signature or a bad address is refused', async () => {
    const { service, sent } = setup()
    const forOther = await signed(other, 'set', 'me@example.com', true)
    await expect(service.set({ ...forOther, wallet: me.address }, 'me@example.com', true)).rejects.toMatchObject({ code: 'signature_mismatch' })
    await expect(service.set(await signed(me, 'set', 'a@example.com', true), 'b@example.com', true)).rejects.toMatchObject({ code: 'signature_mismatch' })
    await expect(service.set(await signed(me, 'set', 'a@example.com', true, NOW - 3600), 'a@example.com', true)).rejects.toMatchObject({ code: 'signature_expired' })
    await expect(service.set(await signed(me, 'set', 'nope', true), 'nope', true)).rejects.toMatchObject({ code: 'invalid_email', status: 400 })
    expect(sent).toHaveLength(0)
  })
  test('only the wallet itself can read its settings', async () => {
    const { service } = setup()
    await service.set(await signed(me, 'set', 'me@example.com', true), 'me@example.com', true)
    expect(await service.read(await signed(me, 'read'))).toMatchObject({ email: 'me@example.com', verified: false })
    const stolen = { ...(await signed(other, 'read')), wallet: me.address }
    await expect(service.read(stolen)).rejects.toBeInstanceOf(EmailError)
  })
  test('a failed verification mail is an error, not a silent success', async () => {
    const service = new WalletEmailService({ context, network: 'testnet', store: fakeStore(), sendVerification: async () => { throw new Error('provider down') }, now: () => NOW })
    await expect(service.set(await signed(me, 'set', 'me@example.com', true), 'me@example.com', true)).rejects.toMatchObject({ code: 'verification_not_sent', status: 503 })
  })
})

describe('contacts routes', () => {
  const options = (service: WalletEmailService | null): WaybillApiOptions => ({
    network: 'testnet',
    health: async () => ({ live: true, ready: true, components: [] }),
    readDeal: async () => null,
    readDealEvents: async () => [],
    listAttestors: async () => [],
    readAttestor: async () => null,
    listWalletDeals: async () => [],
    emails: service,
  })
  const headers = (s: Awaited<ReturnType<typeof signed>>) => ({ 'x-waybill-signer': s.wallet, 'x-waybill-signature': s.signature, 'x-waybill-signed-at': String(s.signedAt) })
  const body = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))

  test('set, read and verify over HTTP', async () => {
    const { service, sent } = setup()
    const o = options(service)
    const set = await handleApiRequest({ method: 'POST', url: '/v1/contacts', headers: headers(await signed(me, 'set', 'me@example.com', true)), body: body({ email: 'me@example.com', notify: true }) }, o)
    expect(set).toMatchObject({ status: 200, body: { verified: false } })
    const read = await handleApiRequest({ method: 'GET', url: '/v1/contacts', headers: headers(await signed(me, 'read')) }, o)
    expect(read).toMatchObject({ status: 200, body: { email: 'me@example.com' } })
    expect((await handleApiRequest({ method: 'POST', url: '/v1/contacts/verify', body: body({ token: sent[0]!.token }) }, o)).status).toBe(200)
    expect((await handleApiRequest({ method: 'POST', url: '/v1/contacts/verify', body: body({ token: sent[0]!.token }) }, o)).status).toBe(404)
  })
  test('is unavailable without a provider, needs a signature, and refuses a bad body', async () => {
    const { service } = setup()
    expect((await handleApiRequest({ method: 'GET', url: '/v1/contacts' }, options(null))).status).toBe(503)
    expect((await handleApiRequest({ method: 'GET', url: '/v1/contacts' }, options(service))).status).toBe(401)
    expect((await handleApiRequest({ method: 'POST', url: '/v1/contacts', headers: headers(await signed(me, 'set', 'x@example.com', true)), body: body({ email: 5 }) }, options(service))).status).toBe(400)
    expect((await handleApiRequest({ method: 'POST', url: '/v1/contacts/verify', body: body({ token: 'short' }) }, options(service))).status).toBe(400)
  })
})

describe('email store', () => {
  test('stores only a hash of the token and mails only verified, switched-on addresses', async () => {
    const calls: { text: string; values: readonly unknown[] }[] = []
    const db = { query: async (text: string, values: readonly unknown[] = []) => (calls.push({ text, values }), { rows: [{ verified: false, email: 'a@b.co', wallet: '0xabc' }] as never[] }) }
    const store = new PostgresWalletEmailStore(db as never)
    const token = await store.set('testnet', '0xABC', 'a@b.co', true)
    expect(token).toBeTruthy()
    expect(JSON.stringify(calls[0]!.values)).not.toContain(token!)
    expect(calls[0]!.values[1]).toBe('0xabc')
    await store.recipient('testnet', '0xABC')
    expect(calls[1]!.text).toContain('verified_at IS NOT NULL AND notifications_enabled')
  })
})
