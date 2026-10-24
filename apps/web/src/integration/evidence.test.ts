import { describe, expect, test } from 'bun:test'
import { evidenceCommitment, evidenceMessage, evidenceReader, sha256Hex, uploadEvidence } from './evidence'

describe('evidence client', () => {
  test('the signed text is exactly what the relayer verifies', () => {
    // The same literal is asserted in services/relayer/src/evidence-backend.test.ts; change both together.
    expect(
      evidenceMessage({
        network: 'testnet',
        chainId: 5042002,
        escrow: '0xAbCdEf0000000000000000000000000000000001',
        dealId: 279n,
        action: 'upload',
        signedAt: 1_800_000_000,
        part: 0,
        files: ['0xAA', '0xbb'],
      }),
    ).toBe(
      [
        'Waybill evidence',
        'action: upload',
        'network: testnet',
        'chain: 5042002',
        'escrow: 0xabcdef0000000000000000000000000000000001',
        'deal: 279',
        'part: 1 (index 0)',
        'files: 0xaa,0xbb',
        'signed: 1800000000',
      ].join('\n'),
    )
  })

  test('sha256 and the on-chain commitment are deterministic', async () => {
    const empty = await sha256Hex(new Uint8Array())
    expect(empty).toBe('0xe3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(evidenceCommitment([empty])).toBe(evidenceCommitment([empty]))
    expect(evidenceCommitment([empty, empty])).not.toBe(evidenceCommitment([empty]))
    expect(() => evidenceCommitment([])).toThrow('at least one')
  })

  test('uploads each file once with one signature and returns the commitment', async () => {
    process.env.NEXT_PUBLIC_WAYBILL_API_BASE_URL = 'http://localhost:3001'
    process.env.NEXT_PUBLIC_WAYBILL_NETWORK = 'testnet'
    const a = { name: 'a b.pdf', mimeType: 'application/pdf', bytes: new Uint8Array([1]), sha256: await sha256Hex(new Uint8Array([1])) }
    const b = { name: 'b.txt', mimeType: 'text/plain', bytes: new Uint8Array([2]), sha256: await sha256Hex(new Uint8Array([2])) }
    const calls: { url: string; headers: Record<string, string> }[] = []
    let signs = 0
    const commitment = await uploadEvidence({
      dealId: 5n,
      part: 1,
      signer: '0x00000000000000000000000000000000000000aa',
      files: [a, b],
      sign: async () => (signs++, '0x1234'),
      now: () => 1_800_000_000,
      fetcher: (async (url: string, init: RequestInit) => {
        if (url.endsWith('/v1/evidence/health')) return new Response('{"ok":true}', { status: 200 })
        calls.push({ url, headers: init.headers as Record<string, string> })
        return new Response('{}', { status: 201 })
      }) as unknown as typeof fetch,
    })
    expect(signs).toBe(1)
    expect(calls.map((c) => c.url)).toEqual(['http://localhost:3001/v1/deals/5/evidence/1', 'http://localhost:3001/v1/deals/5/evidence/1'])
    expect(calls[0]!.headers['x-waybill-files']).toBe(`${a.sha256},${b.sha256}`)
    expect(calls[0]!.headers['x-waybill-file-name']).toBe('a%20b.pdf')
    expect(commitment).toBe(evidenceCommitment([a.sha256, b.sha256]))
  })

  test('checks storage before signing, and a retry reuses a still-valid signature', async () => {
    process.env.NEXT_PUBLIC_WAYBILL_API_BASE_URL = 'http://localhost:3001'
    process.env.NEXT_PUBLIC_WAYBILL_NETWORK = 'testnet'
    const f = { name: 'r', mimeType: 'text/plain', bytes: new Uint8Array([9]), sha256: await sha256Hex(new Uint8Array([9])) }
    let signs = 0
    const base = { dealId: 6n, part: 0, signer: '0x00000000000000000000000000000000000000bb', files: [f], sign: async () => (signs++, '0x99' as const) }
    const down = (async () => new Response('{"error":"evidence_unavailable"}', { status: 503 })) as unknown as typeof fetch
    await expect(uploadEvidence({ ...base, fetcher: down })).rejects.toMatchObject({ code: 'evidence_unavailable' })
    expect(signs).toBe(0)
    let t = 1_800_000_000
    let uploads = 0
    const flaky = (async (url: string) => {
      if (url.endsWith('/health')) return new Response('{}', { status: 200 })
      return ++uploads === 1 ? new Response('{"error":"evidence_unavailable"}', { status: 503 }) : new Response('{}', { status: 201 })
    }) as unknown as typeof fetch
    await expect(uploadEvidence({ ...base, fetcher: flaky, now: () => t })).rejects.toMatchObject({ code: 'evidence_unavailable' })
    t += 60
    await uploadEvidence({ ...base, fetcher: flaky, now: () => t })
    expect(signs).toBe(1)
  })

  test('a refused upload stops and reports the code', async () => {
    process.env.NEXT_PUBLIC_WAYBILL_API_BASE_URL = 'http://localhost:3001'
    process.env.NEXT_PUBLIC_WAYBILL_NETWORK = 'testnet'
    const f = { name: 'a', mimeType: 'text/plain', bytes: new Uint8Array([1]), sha256: await sha256Hex(new Uint8Array([1])) }
    await expect(
      uploadEvidence({
        dealId: 5n,
        part: 0,
        signer: '0x00000000000000000000000000000000000000aa',
        files: [f],
        sign: async () => '0x12',
        fetcher: (async () => new Response(JSON.stringify({ error: 'not_a_party' }), { status: 403 })) as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: 'not_a_party', status: 403 })
  })

  test('reading lists and downloads with a single signature', async () => {
    process.env.NEXT_PUBLIC_WAYBILL_API_BASE_URL = 'http://localhost:3001'
    process.env.NEXT_PUBLIC_WAYBILL_NETWORK = 'testnet'
    let signs = 0
    const seen: string[] = []
    const reader = evidenceReader({
      dealId: 7n,
      signer: '0x00000000000000000000000000000000000000aa',
      sign: async (message) => {
        signs++
        expect(message).toContain('action: read')
        expect(message).toContain('part: all')
        return '0xabcd'
      },
      now: () => 1_800_000_000,
      fetcher: (async (url: string, init: RequestInit) => {
        seen.push(url)
        expect((init.headers as Record<string, string>)['x-waybill-signed-at']).toBe('1800000000')
        if (url.endsWith('/evidence')) {
          return new Response(JSON.stringify([{ id: 'a', part: 0, fileName: 'x.pdf', mimeType: 'application/pdf', byteSize: 3, sha256: '0x12', uploadedBy: '0xaa', uploadedAt: 5 }]), { status: 200 })
        }
        return new Response(new Uint8Array([1, 2, 3]), { status: 200 })
      }) as unknown as typeof fetch,
    })
    const files = await reader.list()
    expect(files[0]).toMatchObject({ id: 'a', part: 0, fileName: 'x.pdf', byteSize: 3 })
    expect((await reader.download('a')).size).toBe(3)
    expect(signs).toBe(1)
    expect(seen).toEqual(['http://localhost:3001/v1/deals/7/evidence', 'http://localhost:3001/v1/deals/7/evidence/a'])
  })
})

describe('evidence reader signatures', () => {
  test('a declined signature is asked for again, not remembered', async () => {
    process.env.NEXT_PUBLIC_WAYBILL_API_BASE_URL = 'http://localhost:3001'
    process.env.NEXT_PUBLIC_WAYBILL_NETWORK = 'testnet'
    let signs = 0
    const reader = evidenceReader({
      dealId: 7n,
      signer: '0x00000000000000000000000000000000000000aa',
      sign: async () => {
        signs++
        if (signs === 1) throw new Error('declined')
        return '0xabcd'
      },
      now: () => 1_800_000_000,
      fetcher: (async () => new Response('[]', { status: 200 })) as unknown as typeof fetch,
    })
    await expect(reader.list()).rejects.toThrow('declined')
    await expect(reader.list()).resolves.toEqual([])
    expect(signs).toBe(2)
  })
})

describe('evidence read signature in the tab', () => {
  test('is reused after a reload while valid, and not once expired', async () => {
    process.env.NEXT_PUBLIC_WAYBILL_API_BASE_URL = 'http://localhost:3001'
    process.env.NEXT_PUBLIC_WAYBILL_NETWORK = 'testnet'
    const store = new Map<string, string>()
    ;(globalThis as { sessionStorage?: unknown }).sessionStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) }
    let signs = 0
    let t = 1_800_000_000
    const make = () =>
      evidenceReader({
        dealId: 9n,
        signer: '0x00000000000000000000000000000000000000aa',
        sign: async () => (++signs, '0xabcd'),
        now: () => t,
        fetcher: (async () => new Response('[]', { status: 200 })) as unknown as typeof fetch,
      })
    await make().list()
    await make().list() // a "reload": a new reader, same tab
    expect(signs).toBe(1)
    t += 9 * 60
    await make().list()
    expect(signs).toBe(2)
    delete (globalThis as { sessionStorage?: unknown }).sessionStorage
  })
})
