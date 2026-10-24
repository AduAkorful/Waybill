import { createHash, randomUUID } from 'node:crypto'
import type { Address } from 'viem'
import { decryptEvidence, encryptEvidence } from './evidence-crypto'
import { verifySignedRequest, type EvidenceAuthContext, type SignedRequest } from './evidence-auth'
import type { DualEvidenceStorage, ObjectStore } from './evidence-storage'
import type { EvidencePointer, EvidencePointerInput } from './evidence-store'

/** Largest single file accepted, in bytes. */
export const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024
/** Most files one signature may cover. */
export const MAX_FILES_PER_SIGNATURE = 10

export class EvidenceError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code)
  }
}

export interface EvidenceDependencies {
  context: (dealId: bigint) => EvidenceAuthContext
  key: Uint8Array
  storage: DualEvidenceStorage
  objectStore: ObjectStore
  pointers: {
    insert(pointer: EvidencePointerInput): Promise<EvidencePointer | null>
    listForDeal(network: 'testnet' | 'mainnet', dealId: bigint): Promise<EvidencePointer[]>
  }
  isDealParty(dealId: bigint, address: string): Promise<boolean>
  network: 'testnet' | 'mainnet'
  now?: () => number
}

export interface PublicEvidence {
  id: string
  part: number
  fileName: string | null
  mimeType: string
  byteSize: number
  sha256: string
  uploadedBy: string
  uploadedAt: number | null
}

const sha256 = (bytes: Uint8Array) => `0x${createHash('sha256').update(bytes).digest('hex')}`
const HASH = /^0x[0-9a-fA-F]{64}$/

function toPublic(p: EvidencePointer): PublicEvidence {
  return {
    id: p.id,
    part: p.milestoneIndex,
    fileName: p.fileName ?? null,
    mimeType: p.mimeType,
    byteSize: p.byteSize,
    sha256: p.contentSha256,
    uploadedBy: p.uploadedBy,
    uploadedAt: p.createdAt,
  }
}

/** Evidence upload, listing and download for the parties of a deal. Files are stored only as ciphertext. */
export class EvidenceService {
  constructor(private readonly deps: EvidenceDependencies) {}

  private now(): number {
    return (this.deps.now ?? (() => Math.floor(Date.now() / 1000)))()
  }

  private async authorize(
    dealId: bigint,
    action: 'upload' | 'read',
    signed: SignedRequest,
    part: number | null,
    files: readonly string[],
  ): Promise<Address> {
    let signer: Address
    try {
      signer = await verifySignedRequest(this.deps.context(dealId), action, signed, part, files, this.now())
    } catch (e) {
      throw new EvidenceError(e instanceof Error ? e.message : 'unauthorized', 401)
    }
    if (!(await this.deps.isDealParty(dealId, signer))) throw new EvidenceError('not_a_party', 403)
    return signer
  }

  async upload(input: {
    dealId: bigint
    part: number
    signed: SignedRequest
    files: readonly string[]
    bytes: Uint8Array
    mimeType: string
    fileName: string | null
  }): Promise<PublicEvidence> {
    if (!Number.isInteger(input.part) || input.part < 0 || input.part > 255) throw new EvidenceError('invalid_part', 400)
    if (input.files.length < 1 || input.files.length > MAX_FILES_PER_SIGNATURE || !input.files.every((f) => HASH.test(f))) {
      throw new EvidenceError('invalid_file_list', 400)
    }
    if (input.bytes.length < 1) throw new EvidenceError('empty_file', 400)
    if (input.bytes.length > MAX_EVIDENCE_BYTES) throw new EvidenceError('file_too_large', 413)
    const digest = sha256(input.bytes)
    if (!input.files.map((f) => f.toLowerCase()).includes(digest)) throw new EvidenceError('file_not_in_signed_list', 400)
    const signer = await this.authorize(input.dealId, 'upload', input.signed, input.part, input.files)

    const id = randomUUID()
    const stored = await this.deps.storage.put({
      key: `${this.deps.network}/${input.dealId}/${input.part}/${id}`,
      bytes: encryptEvidence(this.deps.key, input.bytes),
      mimeType: 'application/octet-stream',
    })
    const pointer = await this.deps.pointers.insert({
      id,
      network: this.deps.network,
      dealId: input.dealId,
      milestoneIndex: input.part,
      uploadedBy: signer,
      contentSha256: digest as `0x${string}`,
      objectUri: stored.objectUri,
      ipfsUri: stored.ipfsUri,
      mimeType: input.mimeType,
      byteSize: input.bytes.length,
      fileName: input.fileName,
    })
    if (pointer === null) {
      // the same file is already recorded for this part; remove the duplicate ciphertext just written
      if (this.deps.objectStore.remove) await this.deps.objectStore.remove(stored.objectUri)
      const existing = (await this.deps.pointers.listForDeal(this.deps.network, input.dealId)).find(
        (p) => p.milestoneIndex === input.part && p.contentSha256.toLowerCase() === digest,
      )
      if (!existing) throw new EvidenceError('evidence_record_unavailable', 503)
      return toPublic(existing)
    }
    return toPublic(pointer)
  }

  async list(dealId: bigint, signed: SignedRequest): Promise<PublicEvidence[]> {
    await this.authorize(dealId, 'read', signed, null, [])
    return (await this.deps.pointers.listForDeal(this.deps.network, dealId)).map(toPublic)
  }

  async download(dealId: bigint, evidenceId: string, signed: SignedRequest): Promise<{ bytes: Uint8Array; mimeType: string; fileName: string | null }> {
    await this.authorize(dealId, 'read', signed, null, [])
    const pointer = (await this.deps.pointers.listForDeal(this.deps.network, dealId)).find((p) => p.id === evidenceId)
    if (!pointer) throw new EvidenceError('unknown_evidence', 404)
    if (!this.deps.objectStore.get) throw new EvidenceError('evidence_unavailable', 503)
    const plain = decryptEvidence(this.deps.key, await this.deps.objectStore.get(pointer.objectUri))
    if (sha256(plain) !== pointer.contentSha256.toLowerCase()) throw new EvidenceError('stored_file_does_not_match_record', 500)
    return { bytes: plain, mimeType: pointer.mimeType, fileName: pointer.fileName ?? null }
  }
}
