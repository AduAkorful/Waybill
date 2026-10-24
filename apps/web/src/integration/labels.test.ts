import { describe, expect, test } from 'bun:test'
import { labelMessage, parseDealRanges, setDealLabels, LabelRequestError } from './labels'

const escrow = `0x${'CD'.repeat(20)}`

describe('label message', () => {
  test('is exactly the text the relayer verifies', () => {
    expect(labelMessage({ network: 'testnet', chainId: 5042002, escrow, ranges: [[0n, 278n], [281n, 281n]], label: 'team', signedAt: 1_800_000_000 })).toBe(
      ['Waybill deal label', 'network: testnet', 'chain: 5042002', `escrow: ${'0x' + 'cd'.repeat(20)}`, 'deals: 0-278,281', 'label: team', 'signed: 1800000000'].join('\n'),
    )
  })
})

describe('parseDealRanges', () => {
  test('reads numbers and ranges, sorted, and counts the deals', () => {
    expect(parseDealRanges('281, 0 - 278', 284n)).toEqual({ ok: true, ranges: [[0n, 278n], [281n, 281n]], count: 280n })
  })
  test('says what is wrong', () => {
    for (const bad of ['', 'abc', '5-2', '0-9, 5-12', '0-284']) {
      const r = parseDealRanges(bad, 284n)
      expect(r.ok).toBe(false)
    }
    expect(parseDealRanges('0-284', 284n)).toEqual({ ok: false, reason: 'Deal 284 does not exist yet (the newest is 283).' })
  })
})

describe('setDealLabels', () => {
  process.env.NEXT_PUBLIC_WAYBILL_API_BASE_URL = 'http://localhost:3001'
  process.env.NEXT_PUBLIC_WAYBILL_NETWORK = 'testnet'
  test('signs one message, posts the ranges and returns the count', async () => {
    let seen: { url: string; init: RequestInit } | null = null
    let signed = ''
    const n = await setDealLabels({
      signer: '0xabc',
      ranges: [[0n, 9n]],
      label: 'test',
      sign: async (m) => ((signed = m), '0xsig' as `0x${string}`),
      now: () => 1_800_000_000,
      fetcher: (async (url: string, init: RequestInit) => ((seen = { url, init }), new Response(JSON.stringify({ labelled: 10, label: 'test' })))) as unknown as typeof fetch,
    })
    expect(n).toBe(10)
    expect(signed).toContain('deals: 0-9')
    expect(seen!.url.endsWith('/v1/operator/labels')).toBe(true)
    expect(JSON.parse(String(seen!.init.body))).toEqual({ ranges: [['0', '9']], label: 'test' })
    expect((seen!.init.headers as Record<string, string>)['x-waybill-signed-at']).toBe('1800000000')
  })
  test('turns a refusal into a readable error', async () => {
    const run = setDealLabels({
      signer: '0xabc', ranges: [[0n, 1n]], label: 'team', sign: async () => '0xsig' as `0x${string}`,
      fetcher: (async () => new Response(JSON.stringify({ error: 'not_pauser' }), { status: 403 })) as unknown as typeof fetch,
    })
    await expect(run).rejects.toThrow('Only the pauser wallet can label deals.')
    await expect(run).rejects.toBeInstanceOf(LabelRequestError)
  })
})
