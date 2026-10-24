import type { WaybillNetwork } from '@waybill/network/networks'

export interface EvidencePointerInput {
  id: string
  network: WaybillNetwork
  dealId: bigint
  milestoneIndex: number
  uploadedBy: `0x${string}`
  contentSha256: `0x${string}`
  objectUri: string
  ipfsUri: string
  mimeType: string
  byteSize: number
}

export interface EvidencePointer extends EvidencePointerInput {}

interface EvidenceRow {
  id: string
  network: WaybillNetwork
  deal_id: string | number | bigint
  milestone_index: number
  uploaded_by: `0x${string}`
  content_sha256: `0x${string}`
  object_uri: string
  ipfs_uri: string
  mime_type: string
  byte_size: number
}

interface SqlResult<Row> {
  rows: Row[]
}

interface SqlExecutor {
  query<Row>(text: string, values?: readonly unknown[]): Promise<SqlResult<Row>>
}

const INSERT_SQL = `
  INSERT INTO waybill_evidence_pointers
    (id, network, deal_id, milestone_index, uploaded_by, content_sha256,
     object_uri, ipfs_uri, mime_type, byte_size)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
  ON CONFLICT (network, deal_id, milestone_index, content_sha256) DO NOTHING
  RETURNING id, network, deal_id, milestone_index, uploaded_by,
            content_sha256, object_uri, ipfs_uri, mime_type, byte_size
`

const GET_SQL = `
  SELECT id, network, deal_id, milestone_index, uploaded_by,
         content_sha256, object_uri, ipfs_uri, mime_type, byte_size
  FROM waybill_evidence_pointers
  WHERE network = $1 AND deal_id = $2 AND milestone_index = $3
`

const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/
const HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/
const IPFS_PATTERN = /^ipfs:\/\/[A-Za-z0-9]+/

function validatePointer(pointer: EvidencePointerInput): void {
  if (!UUID_PATTERN.test(pointer.id)) throw new Error('Invalid evidence id')
  if (pointer.dealId < 0n) throw new Error('dealId must be non-negative')
  if (
    !Number.isInteger(pointer.milestoneIndex) ||
    pointer.milestoneIndex < 0 ||
    pointer.milestoneIndex > 255
  ) {
    throw new Error('milestoneIndex must be between 0 and 255')
  }
  if (!ADDRESS_PATTERN.test(pointer.uploadedBy)) throw new Error('Invalid evidence uploader')
  if (!HASH_PATTERN.test(pointer.contentSha256)) throw new Error('Invalid evidence digest')
  if (!/^https?:\/\/|^s3:\/\//.test(pointer.objectUri)) {
    throw new Error('Invalid object-store URI')
  }
  if (!IPFS_PATTERN.test(pointer.ipfsUri)) throw new Error('Invalid IPFS URI')
  if (!pointer.mimeType.trim()) throw new Error('Evidence MIME type cannot be empty')
  if (!Number.isSafeInteger(pointer.byteSize) || pointer.byteSize < 1) {
    throw new Error('Evidence byte size must be a positive safe integer')
  }
}

function toPointer(row: EvidenceRow): EvidencePointer {
  const dealId = BigInt(row.deal_id)
  if (dealId < 0n) throw new Error('Invalid deal_id returned by evidence store')
  return {
    id: row.id,
    network: row.network,
    dealId,
    milestoneIndex: row.milestone_index,
    uploadedBy: row.uploaded_by,
    contentSha256: row.content_sha256,
    objectUri: row.object_uri,
    ipfsUri: row.ipfs_uri,
    mimeType: row.mime_type,
    byteSize: row.byte_size,
  }
}

export class PostgresEvidenceStore {
  constructor(private readonly database: SqlExecutor) {}

  async insert(pointer: EvidencePointerInput): Promise<EvidencePointer | null> {
    validatePointer(pointer)
    const result = await this.database.query<EvidenceRow>(INSERT_SQL, [
      pointer.id,
      pointer.network,
      pointer.dealId.toString(),
      pointer.milestoneIndex,
      pointer.uploadedBy,
      pointer.contentSha256,
      pointer.objectUri,
      pointer.ipfsUri,
      pointer.mimeType,
      pointer.byteSize,
    ])
    return result.rows[0] ? toPointer(result.rows[0]) : null
  }

  async listForMilestone(
    network: WaybillNetwork,
    dealId: bigint,
    milestoneIndex: number,
  ): Promise<EvidencePointer[]> {
    if (dealId < 0n) throw new Error('dealId must be non-negative')
    if (!Number.isInteger(milestoneIndex) || milestoneIndex < 0 || milestoneIndex > 255) {
      throw new Error('milestoneIndex must be between 0 and 255')
    }
    const result = await this.database.query<EvidenceRow>(GET_SQL, [
      network,
      dealId.toString(),
      milestoneIndex,
    ])
    return result.rows.map(toPointer)
  }
}
