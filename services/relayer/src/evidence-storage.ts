export interface EncryptedEvidence {
  key: string
  bytes: Uint8Array
  mimeType: string
}

export interface ObjectStore {
  put(input: {
    key: string
    bytes: Uint8Array
    mimeType: string
  }): Promise<{ uri: string }>
  /** Reads a stored file back. Optional so write-only test stores stay valid. */
  get?(uri: string): Promise<Uint8Array>
  remove?(uri: string): Promise<void>
}

export interface IpfsPinner {
  pin(input: {
    bytes: Uint8Array
    mimeType: string
  }): Promise<{ uri: string }>
}

export interface DigestProvider {
  sha256(bytes: Uint8Array): Promise<`0x${string}`>
}

export interface EvidenceStorageResult {
  contentSha256: `0x${string}`
  byteSize: number
  objectUri: string
  ipfsUri: string
}

const HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/

function validateInput(input: EncryptedEvidence): void {
  if (!input.key.trim()) throw new Error('Evidence storage key cannot be empty')
  if (!(input.bytes instanceof Uint8Array) || input.bytes.length < 1) {
    throw new Error('Evidence bytes cannot be empty')
  }
  if (!input.mimeType.trim()) throw new Error('Evidence MIME type cannot be empty')
}

function validateResult(contentSha256: `0x${string}`, objectUri: string, ipfsUri: string): void {
  if (!HASH_PATTERN.test(contentSha256)) throw new Error('Digest provider returned invalid hash')
  if (!/^https?:\/\/|^s3:\/\//.test(objectUri)) {
    throw new Error('Object store returned invalid URI')
  }
  if (!/^ipfs:\/\/[A-Za-z0-9]+/.test(ipfsUri)) {
    throw new Error('IPFS provider returned invalid URI')
  }
}

export class DualEvidenceStorage {
  constructor(
    private readonly objectStore: ObjectStore,
    private readonly ipfs: IpfsPinner,
    private readonly digest: DigestProvider,
  ) {}

  async put(input: EncryptedEvidence): Promise<EvidenceStorageResult> {
    validateInput(input)
    const contentSha256 = await this.digest.sha256(input.bytes)
    if (!HASH_PATTERN.test(contentSha256)) throw new Error('Digest provider returned invalid hash')

    const object = await this.objectStore.put({
      key: input.key,
      bytes: input.bytes,
      mimeType: input.mimeType,
    })
    try {
      const pinned = await this.ipfs.pin({
        bytes: input.bytes,
        mimeType: input.mimeType,
      })
      validateResult(contentSha256, object.uri, pinned.uri)
      return {
        contentSha256,
        byteSize: input.bytes.length,
        objectUri: object.uri,
        ipfsUri: pinned.uri,
      }
    } catch (error) {
      if (this.objectStore.remove) await this.objectStore.remove(object.uri)
      throw error
    }
  }
}
