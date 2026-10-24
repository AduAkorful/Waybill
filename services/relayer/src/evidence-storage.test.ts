import { describe, expect, test } from 'bun:test'

import { DualEvidenceStorage, type EncryptedEvidence } from './evidence-storage'

const input: EncryptedEvidence = {
  key: 'testnet/deal-1/milestone-0/evidence.bin',
  bytes: new Uint8Array([1, 2, 3]),
  mimeType: 'application/octet-stream',
}
const digest = `0x${'aa'.repeat(32)}` as `0x${string}`

function stores(ipfsFailure = false) {
  const removed: string[] = []
  const object = {
    put: async () => ({ uri: 's3://waybill-private/evidence.bin' }),
    remove: async (uri: string) => { removed.push(uri) },
  }
  const ipfs = {
    pin: async () => {
      if (ipfsFailure) throw new Error('IPFS unavailable')
      return { uri: 'ipfs://bafybeigdyrzt' }
    },
  }
  const digestProvider = { sha256: async () => digest }
  return {
    storage: new DualEvidenceStorage(object, ipfs, digestProvider),
    removed,
  }
}

describe('DualEvidenceStorage', () => {
  test('requires both storage references and returns the verified digest', async () => {
    const { storage } = stores()
    await expect(storage.put(input)).resolves.toEqual({
      contentSha256: digest,
      byteSize: 3,
      objectUri: 's3://waybill-private/evidence.bin',
      ipfsUri: 'ipfs://bafybeigdyrzt',
    })
  })

  test('cleans up a partial object write when IPFS pinning fails', async () => {
    const { storage, removed } = stores(true)
    await expect(storage.put(input)).rejects.toThrow('IPFS unavailable')
    expect(removed).toEqual(['s3://waybill-private/evidence.bin'])
  })

  test('rejects digest and provider URI failures', async () => {
    const { storage } = stores()
    await expect(storage.put({ ...input, bytes: new Uint8Array() })).rejects.toThrow('empty')
    const badDigest = new DualEvidenceStorage(
      { put: async () => ({ uri: 's3://ok/file' }) },
      { pin: async () => ({ uri: 'ipfs://ok' }) },
      { sha256: async () => '0x12' as `0x${string}` },
    )
    await expect(badDigest.put(input)).rejects.toThrow('invalid hash')
  })
})
