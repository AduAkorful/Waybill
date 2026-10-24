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
        'part: 0',
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
