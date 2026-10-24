import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { privateKeyToAccount } from 'viem/accounts'
import { handleApiRequest, type WaybillApiOptions } from './api'
import { evidenceMessage, type EvidenceAuthContext } from './evidence-auth'
import { loadEvidenceService } from './evidence-config'
import { decryptEvidence, encryptEvidence, parseEvidenceKey } from './evidence-crypto'
import { EvidenceService, MAX_EVIDENCE_BYTES } from './evidence-service'
import { DualEvidenceStorage, type ObjectStore } from './evidence-storage'
import type { EvidencePointer, EvidencePointerInput } from './evidence-store'
import { PinataPinner } from './pinata'
import { S3ObjectStore, signV4 } from './s3'
import { ARC_TESTNET } from '@waybill/network/networks'

const sha = (b: Uint8Array) => `0x${createHash('sha256').update(b).digest('hex')}` as `0x${string}`
const key = parseEvidenceKey(`0x${'11'.repeat(32)}`)
const buyer = privateKeyToAccount(`0x${'01'.repeat(32)}`)
const stranger = privateKeyToAccount(`0x${'02'.repeat(32)}`)
const NOW = 1_800_000_000

const context = (dealId: bigint): EvidenceAuthContext => ({
  network: 'testnet',
  chainId: 5042002,
  escrow: `0x${'cc'.repeat(20)}`,
  dealId,
})

function harness() {
  const objects = new Map<string, Uint8Array>()
  const pointers: EvidencePointer[] = []
  const objectStore: ObjectStore = {
    put: async ({ key: k, bytes }) => (objects.set(k, bytes), { uri: `s3://bucket/${k}` }),
    get: async (uri) => objects.get(uri.slice('s3://bucket/'.length))!,
    remove: async (uri) => void objects.delete(uri.slice('s3://bucket/'.length)),
  }
  const storage = new DualEvidenceStorage(objectStore, { pin: async () => ({ uri: 'ipfs://bafybeigdyrztabcdef' }) }, { sha256: async (b) => sha(b) })
  const service = new EvidenceService({
    context,
    key,
    storage,
    objectStore,
    pointers: {
      insert: async (p: EvidencePointerInput) => {
        if (pointers.some((x) => x.dealId === p.dealId && x.milestoneIndex === p.milestoneIndex && x.contentSha256 === p.contentSha256)) return null
        const stored = { ...p, createdAt: NOW } as EvidencePointer
        pointers.push(stored)
        return stored
      },
      listForDeal: async (_n, dealId) => pointers.filter((p) => p.dealId === dealId),
    },
    isDealParty: async (dealId, address) => dealId === 7n && address.toLowerCase() === buyer.address.toLowerCase(),
    network: 'testnet',
    now: () => NOW,
  })
  return { service, objects, pointers }
}

async function signed(account: typeof buyer, deal: bigint, action: 'upload' | 'read', part: number | null, files: string[], at = NOW) {
  return { signer: account.address, signedAt: at, signature: await account.signMessage({ message: evidenceMessage(context(deal), action, at, part, files) }) }
}

describe('evidence message', () => {
  test('is exactly the text the browser signs', () => {
    // The same literal is asserted in apps/web/src/integration/evidence.test.ts; change both together.
    expect(
      evidenceMessage(
        { network: 'testnet', chainId: 5042002, escrow: '0xAbCdEf0000000000000000000000000000000001', dealId: 279n },
        'upload',
        1_800_000_000,
        0,
        ['0xAA', '0xbb'],
      ),
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
})

describe('evidence encryption', () => {
  test('round-trips and rejects a changed byte', () => {
    const plain = new TextEncoder().encode('packing list')
    const stored = encryptEvidence(key, plain)
    expect(Buffer.from(stored).includes(Buffer.from(plain))).toBe(false)
    expect(new TextDecoder().decode(decryptEvidence(key, stored))).toBe('packing list')
    stored[20] = stored[20]! ^ 1
    expect(() => decryptEvidence(key, stored)).toThrow()
  })

  test('requires a 32-byte hex key', () => {
    expect(() => parseEvidenceKey('0x12')).toThrow('32-byte')
  })
})

describe('S3 request signing', () => {
  test('matches the published AWS Signature V4 GET Object example', () => {
    const authorization = signV4({
      method: 'GET',
      path: '/test.txt',
      headers: {
        host: 'examplebucket.s3.amazonaws.com',
        range: 'bytes=0-9',
        'x-amz-content-sha256': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        'x-amz-date': '20130524T000000Z',
      },
      payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      region: 'us-east-1',
      service: 's3',
      amzDate: '20130524T000000Z',
      credentials: { accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' },
    })
    expect(authorization).toContain('Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41')
    expect(authorization).toContain('SignedHeaders=host;range;x-amz-content-sha256;x-amz-date')
  })

  test('puts, gets and removes through a signed fetch', async () => {
    const seen: { method: string; url: string; auth: string | null }[] = []
    const fetcher = (async (url: string, init: RequestInit) => {
      seen.push({ method: init.method!, url, auth: (init.headers as Record<string, string>).authorization ?? null })
      return new Response(init.method === 'GET' ? new Uint8Array([1, 2, 3]) : null, { status: 200 })
    }) as unknown as typeof fetch
    const store = new S3ObjectStore({ endpoint: 'https://s3.example.com', bucket: 'waybill-evidence', region: 'auto', credentials: { accessKeyId: 'id', secretAccessKey: 'secret' } }, fetcher)
    const { uri } = await store.put({ key: 'testnet/7/0/a', bytes: new Uint8Array([9]), mimeType: 'application/octet-stream' })
    expect(uri).toBe('s3://waybill-evidence/testnet/7/0/a')
    expect([...(await store.get(uri))]).toEqual([1, 2, 3])
    await store.remove(uri)
    expect(seen.map((s) => s.method)).toEqual(['PUT', 'GET', 'DELETE'])
    expect(seen[0]!.url).toBe('https://s3.example.com/waybill-evidence/testnet/7/0/a')
    expect(seen.every((s) => s.auth?.startsWith('AWS4-HMAC-SHA256'))).toBe(true)
    await expect(store.get('s3://other/x')).rejects.toThrow('configured bucket')
  })

  test('an endpoint with a path (Supabase Storage) signs and sends the path ahead of the bucket', async () => {
    const seen: { url: string; auth: string }[] = []
    const fetcher = (async (url: string, init: RequestInit) => (seen.push({ url, auth: (init.headers as Record<string, string>).authorization! }), new Response(null, { status: 200 }))) as unknown as typeof fetch
    const credentials = { accessKeyId: 'id', secretAccessKey: 'secret' }
    const now = () => new Date('2026-10-20T12:00:00Z')
    await new S3ObjectStore({ endpoint: 'https://abc.supabase.co/storage/v1/s3', bucket: 'evidence', region: 'us-east-1', credentials }, fetcher, now).put({ key: 'a/b', bytes: new Uint8Array([1]), mimeType: 'text/plain' })
    expect(seen[0]!.url).toBe('https://abc.supabase.co/storage/v1/s3/evidence/a/b')
    const expected = signV4({
      method: 'PUT', path: '/storage/v1/s3/evidence/a/b', region: 'us-east-1', service: 's3', amzDate: '20261020T120000Z', credentials,
      payloadHash: createHash('sha256').update(new Uint8Array([1])).digest('hex'),
      headers: { host: 'abc.supabase.co', 'x-amz-content-sha256': createHash('sha256').update(new Uint8Array([1])).digest('hex'), 'x-amz-date': '20261020T120000Z', 'content-type': 'text/plain' },
    })
    expect(seen[0]!.auth).toBe(expected)
  })

  test('refuses a plain-http endpoint and a bad bucket', () => {
    const cfg = { region: 'r', credentials: { accessKeyId: 'a', secretAccessKey: 'b' } }
    expect(() => new S3ObjectStore({ ...cfg, endpoint: 'http://s3.example.com', bucket: 'okbucket' })).toThrow('https')
    expect(() => new S3ObjectStore({ ...cfg, endpoint: 'https://s3.example.com/', bucket: 'okbucket' })).toThrow('https')
    expect(() => new S3ObjectStore({ ...cfg, endpoint: 'https://s3.example.com/x?y=1', bucket: 'okbucket' })).toThrow('https')
    expect(() => new S3ObjectStore({ ...cfg, endpoint: 'https://s3.example.com', bucket: 'Bad_Bucket' })).toThrow('bucket')
  })
})

describe('Pinata pinning', () => {
  test('posts the file with a bearer token and returns an ipfs uri', async () => {
    let auth = ''
    const fetcher = (async (_url: string, init: RequestInit) => {
      auth = (init.headers as Record<string, string>).authorization!
      return new Response(JSON.stringify({ IpfsHash: 'bafybeigdyrztabcdef' }), { status: 200 })
    }) as unknown as typeof fetch
    const pinner = new PinataPinner('jwt-token', fetcher)
    expect((await pinner.pin({ bytes: new Uint8Array([1]), mimeType: 'application/octet-stream' })).uri).toBe('ipfs://bafybeigdyrztabcdef')
    expect(auth).toBe('Bearer jwt-token')
  })

  test('fails on a provider error or a missing content id', async () => {
    const fail = new PinataPinner('t', (async () => new Response('no', { status: 500 })) as unknown as typeof fetch)
    await expect(fail.pin({ bytes: new Uint8Array([1]), mimeType: 'a/b' })).rejects.toThrow('500')
    const empty = new PinataPinner('t', (async () => new Response('{}', { status: 200 })) as unknown as typeof fetch)
    await expect(empty.pin({ bytes: new Uint8Array([1]), mimeType: 'a/b' })).rejects.toThrow('content id')
  })
})

describe('EvidenceService', () => {
  const file = new TextEncoder().encode('inspection photos')
  const digest = sha(file)
  const upload = async (h: ReturnType<typeof harness>, over: Partial<Parameters<EvidenceService['upload']>[0]> = {}) =>
    h.service.upload({ dealId: 7n, part: 0, signed: await signed(buyer, 7n, 'upload', 0, [digest]), files: [digest], bytes: file, mimeType: 'image/png', fileName: 'a.png', ...over })

  test('a deal party uploads; the stored copy is ciphertext and the record keeps the plain digest', async () => {
    const h = harness()
    const out = await upload(h)
    expect(out).toMatchObject({ part: 0, fileName: 'a.png', mimeType: 'image/png', byteSize: file.length, sha256: digest })
    const stored = [...h.objects.values()][0]!
    expect(Buffer.from(stored).includes(Buffer.from(file))).toBe(false)
  })

  test('a party reads the list and downloads the original bytes', async () => {
    const h = harness()
    const out = await upload(h)
    const list = await h.service.list(7n, await signed(buyer, 7n, 'read', null, []))
    expect(list.map((e) => e.id)).toEqual([out.id])
    const dl = await h.service.download(7n, out.id, await signed(buyer, 7n, 'read', null, []))
    expect(new TextDecoder().decode(dl.bytes)).toBe('inspection photos')
  })

  test('refuses a wallet the escrow does not name', async () => {
    const h = harness()
    await expect(upload(h, { signed: await signed(stranger, 7n, 'upload', 0, [digest]) })).rejects.toMatchObject({ code: 'not_a_party', status: 403 })
    expect(h.objects.size).toBe(0)
  })

  test('refuses a file that is not in the signed list, an old signature, and another deal or part', async () => {
    const h = harness()
    await expect(upload(h, { bytes: new TextEncoder().encode('different') })).rejects.toMatchObject({ code: 'file_not_in_signed_list' })
    await expect(upload(h, { signed: await signed(buyer, 7n, 'upload', 0, [digest], NOW - 3600) })).rejects.toMatchObject({ code: 'signature_expired', status: 401 })
    await expect(upload(h, { signed: await signed(buyer, 8n, 'upload', 0, [digest]) })).rejects.toMatchObject({ code: 'signature_mismatch' })
    await expect(upload(h, { part: 1 })).rejects.toMatchObject({ code: 'signature_mismatch' })
    expect(h.objects.size).toBe(0)
  })

  test('refuses empty, oversized and malformed uploads before storing anything', async () => {
    const h = harness()
    await expect(upload(h, { bytes: new Uint8Array() })).rejects.toMatchObject({ code: 'empty_file' })
    await expect(upload(h, { bytes: new Uint8Array(MAX_EVIDENCE_BYTES + 1) })).rejects.toMatchObject({ code: 'file_too_large', status: 413 })
    await expect(upload(h, { files: ['0x12'] })).rejects.toMatchObject({ code: 'invalid_file_list' })
    await expect(upload(h, { part: 300 })).rejects.toMatchObject({ code: 'invalid_part' })
    expect(h.objects.size).toBe(0)
  })

  test('uploading the same file twice keeps one record and one stored copy', async () => {
    const h = harness()
    const first = await upload(h)
    const second = await upload(h)
    expect(second.id).toBe(first.id)
    expect(h.pointers.length).toBe(1)
    expect(h.objects.size).toBe(1)
  })

  test('a stored file that no longer matches its record is never returned', async () => {
    const h = harness()
    const out = await upload(h)
    const [k] = [...h.objects.keys()]
    h.objects.set(k!, encryptEvidence(key, new TextEncoder().encode('swapped')))
    await expect(h.service.download(7n, out.id, await signed(buyer, 7n, 'read', null, []))).rejects.toMatchObject({ code: 'stored_file_does_not_match_record' })
  })
})

describe('evidence routes', () => {
  const file = new TextEncoder().encode('proof')
  const digest = sha(file)
  function options(service: EvidenceService | null): WaybillApiOptions {
    const never = async () => {
      throw new Error('unused')
    }
    return {
      network: 'testnet',
      allowedOrigins: ['http://localhost:3000'],
      health: never as never,
      readDeal: never,
      readDealEvents: never,
      listAttestors: never,
      readAttestor: never,
      listWalletDeals: never,
      evidence: service,
    }
  }
  const headers = (s: { signer: string; signature: string; signedAt: number }, files: string[]) => ({
    origin: 'http://localhost:3000',
    'x-waybill-signer': s.signer,
    'x-waybill-signature': s.signature,
    'x-waybill-signed-at': String(s.signedAt),
    'x-waybill-files': files.join(','),
    'x-waybill-file-name': encodeURIComponent('packing list.pdf'),
    'content-type': 'application/pdf',
  })

  test('POST stores, GET lists, GET by id returns the file bytes', async () => {
    const h = harness()
    const originalNow = Date.now
    Date.now = () => NOW * 1000
    try {
      const up = await handleApiRequest(
        { method: 'POST', url: '/v1/deals/7/evidence/0', headers: headers(await signed(buyer, 7n, 'upload', 0, [digest]), [digest]), body: file },
        options(h.service),
      )
      expect(up.status).toBe(201)
      const id = (up.body as { id: string }).id
      const read = headers(await signed(buyer, 7n, 'read', null, []), [])
      const list = await handleApiRequest({ method: 'GET', url: '/v1/deals/7/evidence', headers: read }, options(h.service))
      expect(list.status).toBe(200)
      expect((list.body as { fileName: string }[])[0]!.fileName).toBe('packing list.pdf')
      const dl = await handleApiRequest({ method: 'GET', url: `/v1/deals/7/evidence/${id}`, headers: read }, options(h.service))
      expect(dl.status).toBe(200)
      expect(new TextDecoder().decode(dl.bytes)).toBe('proof')
      expect(dl.headers?.['content-type']).toBe('application/pdf')
      expect(dl.headers?.['x-content-type-options']).toBe('nosniff')
    } finally {
      Date.now = originalNow
    }
  })

  test('answers 401 without a signature, 503 when evidence is not configured, 403 for a stranger', async () => {
    const h = harness()
    expect((await handleApiRequest({ method: 'GET', url: '/v1/deals/7/evidence', headers: { origin: 'http://localhost:3000' } }, options(h.service))).status).toBe(401)
    expect((await handleApiRequest({ method: 'GET', url: '/v1/deals/7/evidence', headers: { origin: 'http://localhost:3000' } }, options(null))).status).toBe(503)
    const originalNow = Date.now
    Date.now = () => NOW * 1000
    try {
      const denied = await handleApiRequest(
        { method: 'GET', url: '/v1/deals/7/evidence', headers: headers(await signed(stranger, 7n, 'read', null, []), []) },
        options(h.service),
      )
      expect(denied.status).toBe(403)
    } finally {
      Date.now = originalNow
    }
  })

  test('preflight allows POST and the signature headers; other routes still refuse writes', async () => {
    const pre = await handleApiRequest({ method: 'OPTIONS', url: '/v1/deals/7/evidence/0', headers: { origin: 'http://localhost:3000' } }, options(null))
    expect(pre.headers?.['access-control-allow-methods']).toBe('GET, POST')
    expect(pre.headers?.['access-control-allow-headers']).toContain('x-waybill-signature')
    expect((await handleApiRequest({ method: 'POST', url: '/v1/deals/7', headers: {} }, options(null))).status).toBe(405)
  })
})

describe('evidence configuration', () => {
  const deps = { pointers: { insert: async () => null, listForDeal: async () => [] }, isDealParty: async () => false }
  const all = {
    WAYBILL_EVIDENCE_KEY: `0x${'11'.repeat(32)}`,
    WAYBILL_EVIDENCE_S3_ENDPOINT: 'https://s3.example.com',
    WAYBILL_EVIDENCE_S3_BUCKET: 'waybill-evidence',
    WAYBILL_EVIDENCE_S3_REGION: 'auto',
    WAYBILL_EVIDENCE_S3_ACCESS_KEY_ID: 'id',
    WAYBILL_EVIDENCE_S3_SECRET_ACCESS_KEY: 'secret',
    WAYBILL_EVIDENCE_PINATA_JWT: 'jwt',
  }

  test('none set disables it, all set enables it, some set refuses to start', () => {
    expect(loadEvidenceService({}, ARC_TESTNET, deps)).toBeNull()
    expect(loadEvidenceService(all, ARC_TESTNET, deps)).toBeInstanceOf(EvidenceService)
    const { WAYBILL_EVIDENCE_PINATA_JWT: _omit, ...partial } = all
    expect(() => loadEvidenceService(partial, ARC_TESTNET, deps)).toThrow('WAYBILL_EVIDENCE_PINATA_JWT')
  })
})
