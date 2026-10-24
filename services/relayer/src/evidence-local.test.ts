import { describe, expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assertLocalEvidenceAllowed, LocalDirObjectStore, LocalPinner } from './evidence-local'

describe('local dev evidence backend', () => {
  test('is refused unless the RPC is on this machine and not production', () => {
    expect(() => assertLocalEvidenceAllowed('https://rpc.testnet.arc.network', {})).toThrow()
    expect(() => assertLocalEvidenceAllowed('http://127.0.0.1:8545', { NODE_ENV: 'production' })).toThrow()
    expect(() => assertLocalEvidenceAllowed('http://127.0.0.1:8545', {})).not.toThrow()
    expect(() => assertLocalEvidenceAllowed('http://localhost:8089/rpc', {})).not.toThrow()
  })
  test('round-trips bytes and stays inside its directory', async () => {
    const store = new LocalDirObjectStore(mkdtempSync(join(tmpdir(), 'ev-')))
    const { uri } = await store.put({ key: 'deal/1/a.bin', bytes: new Uint8Array([1, 2, 3]), mimeType: 'application/octet-stream' })
    expect(uri.startsWith('s3://waybill-localdev/')).toBe(true)
    expect(uri).toMatch(/^https?:\/\/|^s3:\/\//) // what the pointer table's CHECK accepts
    expect([...(await store.get(uri))]).toEqual([1, 2, 3])
    await expect(store.put({ key: '../../etc/x', bytes: new Uint8Array(), mimeType: 'x' })).rejects.toThrow()
    expect((await new LocalPinner().pin({ bytes: new Uint8Array([1]), mimeType: 'x' })).uri).toMatch(/^ipfs:\/\/localdev[0-9a-f]{64}$/)
  })
})
