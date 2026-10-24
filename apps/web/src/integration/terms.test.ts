import { describe, expect, test } from 'bun:test'
import { canonicalTerms, readPublicTerms, readTermsSigned, saveTerms, termsDigest, termsMessage, TermsRequestError } from './terms'

const goods = { goods: 'Cotton t-shirts', units: 5000, origin: { code: 'CN', city: 'Shenzhen' }, destination: { code: 'GH', city: 'Accra' }, milestoneTitles: ['Deposit', 'Delivery'] }

describe('terms hashing', () => {
  test('matches the relayer: the digest of the canonical text is this exact value', async () => {
    expect(canonicalTerms(goods)).toBe('{"goods":"Cotton t-shirts","units":5000,"origin":{"code":"CN","city":"Shenzhen"},"destination":{"code":"GH","city":"Accra"},"milestoneTitles":["Deposit","Delivery"]}')
    expect(await termsDigest(goods)).toBe('408f6333976522bb5ac0e7ec7beba67f315259eb2e2c12d5dc9826b52c58a1d7')
  })
  test('key order in the input does not change it', async () => {
    expect(await termsDigest({ units: 5000, goods: 'Cotton t-shirts', milestoneTitles: ['Deposit', 'Delivery'], destination: { city: 'Accra', code: 'GH' }, origin: { city: 'Shenzhen', code: 'CN' } })).toBe(await termsDigest(goods))
  })
})

describe('terms message', () => {
  const base = { network: 'testnet', chainId: 5042002, escrow: `0x${'CD'.repeat(20)}`, dealId: 7n, signedAt: 1_800_000_000 }
  test('is exactly the text the relayer verifies', () => {
    expect(termsMessage({ ...base, action: 'set', digest: 'abc', isPublic: true })).toBe(
      ['Waybill deal terms', 'action: set', 'network: testnet', 'chain: 5042002', `escrow: 0x${'cd'.repeat(20)}`, 'deal: 7', 'terms: abc', 'public: yes', 'signed: 1800000000'].join('\n'),
    )
    expect(termsMessage({ ...base, action: 'read', digest: 'ignored', isPublic: null })).toContain('terms: none, this only reads\npublic: not applicable')
  })
})

describe('terms client', () => {
  process.env.NEXT_PUBLIC_WAYBILL_API_BASE_URL = 'http://localhost:3001'
  process.env.NEXT_PUBLIC_WAYBILL_NETWORK = 'testnet'
  const reply = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch

  test('saves with one signature over the digest and the public flag', async () => {
    let signed = ''
    let sent: RequestInit | null = null
    await saveTerms({
      dealId: 7n, signer: '0xabc', terms: goods, isPublic: false, now: () => 1_800_000_000,
      sign: async (m) => ((signed = m), '0xsig' as `0x${string}`),
      fetcher: (async (_u: string, init: RequestInit) => ((sent = init), new Response(JSON.stringify({ terms: goods, isPublic: false, setBy: '0xabc', updatedAt: 1 })))) as unknown as typeof fetch,
    })
    expect(signed).toContain('terms: 408f6333976522bb5ac0e7ec7beba67f315259eb2e2c12d5dc9826b52c58a1d7')
    expect(signed).toContain('public: no')
    expect(JSON.parse(String(sent!.body))).toEqual({ terms: goods, public: false })
  })
  test('public reads need no signature and treat private or missing as none', async () => {
    expect(await readPublicTerms(7n, reply(200, { terms: null }))).toBeNull()
    expect((await readPublicTerms(7n, reply(200, { terms: { terms: goods, isPublic: true, setBy: '0x', updatedAt: 1 } })))?.terms.units).toBe(5000)
    await expect(readPublicTerms(7n, reply(503, { error: 'terms_unavailable' }))).rejects.toThrow('not available')
  })
  test('refusals read as plain sentences', async () => {
    await expect(readTermsSigned({ dealId: 7n, signer: '0xabc', sign: async () => '0xs' as `0x${string}`, fetcher: reply(403, { error: 'not_a_party' }) })).rejects.toThrow('not named in the deal')
    await expect(saveTerms({ dealId: 7n, signer: '0xabc', terms: goods, isPublic: false, sign: async () => '0xs' as `0x${string}`, fetcher: reply(409, { error: 'deal_locked' }) })).rejects.toBeInstanceOf(TermsRequestError)
  })
})
