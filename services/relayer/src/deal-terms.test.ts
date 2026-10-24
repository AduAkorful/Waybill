import { describe, expect, test } from 'bun:test'
import { privateKeyToAccount } from 'viem/accounts'
import { handleApiRequest, type WaybillApiOptions } from './api'
import { DealTermsService, PostgresTermsStore, TermsError, canonicalTerms, parseTerms, termsDigest, termsMessage, type DealTerms, type StoredTerms } from './deal-terms'

const buyer = privateKeyToAccount(`0x${'55'.repeat(32)}`)
const supplier = privateKeyToAccount(`0x${'66'.repeat(32)}`)
const stranger = privateKeyToAccount(`0x${'77'.repeat(32)}`)
const escrow = `0x${'cd'.repeat(20)}` as `0x${string}`
const NOW = 1_800_000_000
const context = (dealId: bigint) => ({ network: 'testnet', chainId: 5042002, escrow, dealId })
const goods: DealTerms = { goods: 'Cotton t-shirts', units: 5000, origin: { code: 'CN', city: 'Shenzhen' }, destination: { code: 'GH', city: 'Accra' }, milestoneTitles: ['Deposit', 'Delivery'] }

function setup(state: string | null = 'CREATED') {
  const rows = new Map<string, StoredTerms>()
  const service = new DealTermsService({
    context,
    network: 'testnet',
    store: {
      upsert: async (_n, id, terms, isPublic, setBy) => void rows.set(String(id), { terms, isPublic, setBy, updatedAt: NOW }),
      get: async (_n, id) => rows.get(String(id)) ?? null,
    },
    isBuyer: async (_d, a) => a.toLowerCase() === buyer.address.toLowerCase(),
    isParty: async (_d, a) => [buyer.address, supplier.address].some((p) => p.toLowerCase() === a.toLowerCase()),
    dealState: async () => state,
    now: () => NOW,
  })
  return { service, rows }
}

const signSet = async (account: typeof buyer, terms: DealTerms, isPublic: boolean, signedAt = NOW) => ({
  signer: account.address,
  signedAt,
  signature: await account.signMessage({ message: termsMessage(context(7n), 'set', termsDigest(terms), isPublic, signedAt) }),
})
const signRead = async (account: typeof buyer, signedAt = NOW) => ({
  signer: account.address,
  signedAt,
  signature: await account.signMessage({ message: termsMessage(context(7n), 'read', '-', null, signedAt) }),
})

describe('terms parsing', () => {
  test('keeps known fields, drops unknown ones, and fixes the key order for hashing', () => {
    const terms = parseTerms({ units: 5, goods: ' Tea ', surprise: 'x', destination: { city: 'Accra', code: 'GH' } })
    expect(terms).toEqual({ goods: 'Tea', units: 5, destination: { code: 'GH', city: 'Accra' } })
    expect(canonicalTerms(terms)).toBe('{"goods":"Tea","units":5,"destination":{"code":"GH","city":"Accra"}}')
  })
  test('refuses empty terms, control characters, bad codes, long text and too many titles', () => {
    for (const bad of [{}, null, [], { goods: 'a\nb' }, { goods: 'x'.repeat(301) }, { origin: { code: 'china', city: 'x' } }, { units: -1 }, { units: 1.5 }, { milestoneTitles: Array(9).fill('a') }]) {
      expect(() => parseTerms(bad)).toThrow(TermsError)
    }
  })
  test('the digest is pinned (the web app asserts the same value)', () => {
    expect(termsDigest(goods)).toBe('408f6333976522bb5ac0e7ec7beba67f315259eb2e2c12d5dc9826b52c58a1d7')
  })
})

describe('terms service', () => {
  test('the buyer sets terms on an unfunded deal; private terms are readable only by a party', async () => {
    const { service } = setup()
    await service.set(7n, goods, false, await signSet(buyer, goods, false))
    await expect(service.read(7n, null)).rejects.toMatchObject({ code: 'missing_signature' })
    expect((await service.read(7n, await signRead(supplier)))?.terms.goods).toBe('Cotton t-shirts')
    await expect(service.read(7n, await signRead(stranger))).rejects.toMatchObject({ code: 'not_a_party', status: 403 })
  })
  test('public terms are readable by anyone without a signature', async () => {
    const { service } = setup()
    await service.set(7n, goods, true, await signSet(buyer, goods, true))
    expect((await service.read(7n, null))?.terms.units).toBe(5000)
  })
  test('nobody but the buyer can set them, and a different digest or flag breaks the signature', async () => {
    const { service, rows } = setup()
    await expect(service.set(7n, goods, false, await signSet(supplier, goods, false))).rejects.toMatchObject({ code: 'not_buyer', status: 403 })
    const signed = await signSet(buyer, goods, false)
    await expect(service.set(7n, { ...goods, units: 6000 }, false, signed)).rejects.toMatchObject({ code: 'signature_mismatch' })
    await expect(service.set(7n, goods, true, signed)).rejects.toMatchObject({ code: 'signature_mismatch' })
    await expect(service.set(7n, goods, false, await signSet(buyer, goods, false, NOW - 3600))).rejects.toMatchObject({ code: 'signature_expired' })
    expect(rows.size).toBe(0)
  })
  test('terms cannot be changed once the deal is funded, and an unknown deal is refused', async () => {
    await expect(setup('FUNDED').service.set(7n, goods, false, await signSet(buyer, goods, false))).rejects.toMatchObject({ code: 'deal_locked', status: 409 })
    await expect(setup(null).service.set(7n, goods, false, await signSet(buyer, goods, false))).rejects.toMatchObject({ code: 'unknown_deal' })
  })
  test('reading when nothing is set gives null', async () => {
    expect(await setup().service.read(7n, null)).toBeNull()
  })
})

describe('terms routes', () => {
  const base = (service: DealTermsService | null): WaybillApiOptions => ({
    network: 'testnet',
    health: async () => ({ live: true, ready: true, components: [] }),
    readDeal: async () => null,
    readDealEvents: async () => [],
    listAttestors: async () => [],
    readAttestor: async () => null,
    listWalletDeals: async () => [],
    terms: service,
  })
  const hdr = (s: { signer: string; signature: string; signedAt: number }) => ({ 'x-waybill-signer': s.signer, 'x-waybill-signature': s.signature, 'x-waybill-signed-at': String(s.signedAt) })
  const json = (v: unknown) => new TextEncoder().encode(JSON.stringify(v))

  test('POST then GET over HTTP', async () => {
    const { service } = setup()
    const o = base(service)
    const posted = await handleApiRequest({ method: 'POST', url: '/v1/deals/7/terms', headers: hdr(await signSet(buyer, goods, true)), body: json({ terms: goods, public: true }) }, o)
    expect(posted.status).toBe(200)
    const got = await handleApiRequest({ method: 'GET', url: '/v1/deals/7/terms' }, o)
    expect(got).toMatchObject({ status: 200, body: { isPublic: true, terms: { goods: 'Cotton t-shirts' } } })
  })
  test('?public=1 answers 200 with the terms only when public, and null otherwise', async () => {
    const { service } = setup()
    const o = base(service)
    expect(await handleApiRequest({ method: 'GET', url: '/v1/deals/7/terms?public=1' }, o)).toMatchObject({ status: 200, body: { terms: null } })
    await handleApiRequest({ method: 'POST', url: '/v1/deals/7/terms', headers: hdr(await signSet(buyer, goods, false)), body: json({ terms: goods, public: false }) }, o)
    expect(await handleApiRequest({ method: 'GET', url: '/v1/deals/7/terms?public=1' }, o)).toMatchObject({ status: 200, body: { terms: null } })
    await handleApiRequest({ method: 'POST', url: '/v1/deals/7/terms', headers: hdr(await signSet(buyer, goods, true)), body: json({ terms: goods, public: true }) }, o)
    expect(await handleApiRequest({ method: 'GET', url: '/v1/deals/7/terms?public=1' }, o)).toMatchObject({ status: 200, body: { terms: { isPublic: true } } })
  })
  test('unavailable without a service, 404 when none set, 401 unsigned write, 400 bad body', async () => {
    const { service } = setup()
    expect((await handleApiRequest({ method: 'GET', url: '/v1/deals/7/terms' }, base(null))).status).toBe(503)
    expect((await handleApiRequest({ method: 'GET', url: '/v1/deals/7/terms' }, base(service))).status).toBe(404)
    expect((await handleApiRequest({ method: 'POST', url: '/v1/deals/7/terms', body: json({ terms: goods, public: true }) }, base(service))).status).toBe(401)
    expect((await handleApiRequest({ method: 'POST', url: '/v1/deals/7/terms', headers: hdr(await signSet(buyer, goods, true)), body: json({ terms: goods }) }, base(service))).status).toBe(400)
  })
})

describe('terms store', () => {
  test('writes parameterized JSON and reads it back', async () => {
    const calls: { text: string; values: readonly unknown[] }[] = []
    const db = { query: async (text: string, values: readonly unknown[] = []) => (calls.push({ text, values }), { rows: [{ terms: { goods: 'x' }, is_public: true, set_by: '0xabc', updated: '5' }] as never[] }) }
    const store = new PostgresTermsStore(db as never)
    await store.upsert('testnet', 7n, { goods: 'x' }, true, '0xABC')
    expect(calls[0]!.values).toEqual(['testnet', '7', '{"goods":"x"}', true, '0xABC'])
    expect(await store.get('testnet', 7n)).toEqual({ terms: { goods: 'x' }, isPublic: true, setBy: '0xabc', updatedAt: 5 })
  })
})
