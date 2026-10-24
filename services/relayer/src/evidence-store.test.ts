import { describe, expect, test } from 'bun:test'

import {
  PostgresEvidenceStore,
  type EvidencePointerInput,
} from './evidence-store'

class FakeDatabase {
  readonly calls: { text: string; values: readonly unknown[] }[] = []
  constructor(private readonly inserted: boolean = true) {}

  async query<Row>(text: string, values: readonly unknown[] = []) {
    this.calls.push({ text, values })
    if (text.includes('INSERT') && this.inserted) {
      return {
        rows: [{
          id: values[0],
          network: values[1],
          deal_id: values[2],
          milestone_index: values[3],
          uploaded_by: values[4],
          content_sha256: values[5],
          object_uri: values[6],
          ipfs_uri: values[7],
          mime_type: values[8],
          byte_size: values[9],
          file_name: values[10],
          created_unix: 1_700_000_000,
        }] as Row[],
      }
    }
    return { rows: [] as Row[] }
  }
}

const pointer: EvidencePointerInput = {
  id: '123e4567-e89b-12d3-a456-426614174000',
  network: 'testnet',
  dealId: 5n,
  milestoneIndex: 2,
  uploadedBy: `0x${'11'.repeat(20)}`,
  contentSha256: `0x${'aa'.repeat(32)}`,
  objectUri: 's3://waybill-private/evidence/5/2/a',
  ipfsUri: 'ipfs://bafybeigdyrzt',
  mimeType: 'application/pdf',
  byteSize: 1024,
}

describe('PostgresEvidenceStore', () => {
  test('inserts dual-store immutable pointers with a digest', async () => {
    const database = new FakeDatabase()
    const store = new PostgresEvidenceStore(database)

    await expect(store.insert({ ...pointer, fileName: 'invoice.pdf' })).resolves.toEqual({
      ...pointer,
      fileName: 'invoice.pdf',
      createdAt: 1_700_000_000,
    })
    expect(database.calls[0]?.values).toEqual([
      pointer.id,
      'testnet',
      '5',
      2,
      pointer.uploadedBy,
      pointer.contentSha256,
      pointer.objectUri,
      pointer.ipfsUri,
      pointer.mimeType,
      1024,
      'invoice.pdf',
    ])
    expect(database.calls[0]?.text).not.toContain(pointer.ipfsUri)
  })

  test('returns null for a duplicate content binding and reads by milestone', async () => {
    const duplicateStore = new PostgresEvidenceStore(new FakeDatabase(false))
    await expect(duplicateStore.insert(pointer)).resolves.toBeNull()
    const missingStore = new PostgresEvidenceStore({
      query: async () => ({ rows: [] }),
    })
    await expect(missingStore.listForMilestone('mainnet', 5n, 2)).resolves.toEqual([])
  })

  test('rejects invalid identity, URI, digest, and size', async () => {
    const store = new PostgresEvidenceStore(new FakeDatabase())
    await expect(store.insert({ ...pointer, id: 'not-a-uuid' })).rejects.toThrow('evidence id')
    await expect(store.insert({ ...pointer, ipfsUri: 'https://not-ipfs' })).rejects.toThrow(
      'IPFS',
    )
    await expect(store.insert({ ...pointer, contentSha256: '0x12' })).rejects.toThrow(
      'digest',
    )
    await expect(store.insert({ ...pointer, byteSize: 0 })).rejects.toThrow('byte size')
  })
})
