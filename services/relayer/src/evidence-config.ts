import { createHash } from 'node:crypto'
import type { RuntimeEnvironment } from '@waybill/network/runtime'
import type { WaybillNetworkManifest } from '@waybill/network/networks'
import { parseEvidenceKey } from './evidence-crypto'
import { EvidenceService } from './evidence-service'
import { DualEvidenceStorage } from './evidence-storage'
import type { EvidencePointer, EvidencePointerInput } from './evidence-store'
import { PinataPinner } from './pinata'
import { S3ObjectStore } from './s3'

const NAMES = [
  'WAYBILL_EVIDENCE_KEY',
  'WAYBILL_EVIDENCE_S3_ENDPOINT',
  'WAYBILL_EVIDENCE_S3_BUCKET',
  'WAYBILL_EVIDENCE_S3_REGION',
  'WAYBILL_EVIDENCE_S3_ACCESS_KEY_ID',
  'WAYBILL_EVIDENCE_S3_SECRET_ACCESS_KEY',
  'WAYBILL_EVIDENCE_PINATA_JWT',
] as const

/**
 * Evidence upload is opt-in and all-or-nothing: with none of its settings the API answers evidence routes with 503,
 * with some missing the process refuses to start, so a half-configured store never takes files it cannot keep twice.
 */
export function loadEvidenceService(
  environment: RuntimeEnvironment,
  network: WaybillNetworkManifest,
  deps: {
    pointers: { insert(p: EvidencePointerInput): Promise<EvidencePointer | null>; listForDeal(n: 'testnet' | 'mainnet', d: bigint): Promise<EvidencePointer[]> }
    isDealParty(dealId: bigint, address: string): Promise<boolean>
  },
  fetcher: typeof fetch = fetch,
): EvidenceService | null {
  const set = NAMES.filter((n) => environment[n]?.trim())
  if (set.length === 0) return null
  const missing = NAMES.filter((n) => !environment[n]?.trim())
  if (missing.length > 0) throw new Error(`Evidence storage is partly configured; missing: ${missing.join(', ')}`)
  const get = (n: (typeof NAMES)[number]) => environment[n]!.trim()

  const objectStore = new S3ObjectStore(
    {
      endpoint: get('WAYBILL_EVIDENCE_S3_ENDPOINT'),
      bucket: get('WAYBILL_EVIDENCE_S3_BUCKET'),
      region: get('WAYBILL_EVIDENCE_S3_REGION'),
      credentials: { accessKeyId: get('WAYBILL_EVIDENCE_S3_ACCESS_KEY_ID'), secretAccessKey: get('WAYBILL_EVIDENCE_S3_SECRET_ACCESS_KEY') },
    },
    fetcher,
  )
  const storage = new DualEvidenceStorage(objectStore, new PinataPinner(get('WAYBILL_EVIDENCE_PINATA_JWT'), fetcher), {
    sha256: async (bytes) => `0x${createHash('sha256').update(bytes).digest('hex')}`,
  })
  return new EvidenceService({
    context: (dealId) => ({ network: network.network, chainId: network.chainId, escrow: network.contracts.escrow, dealId }),
    key: parseEvidenceKey(get('WAYBILL_EVIDENCE_KEY')),
    storage,
    objectStore,
    pointers: deps.pointers,
    isDealParty: deps.isDealParty,
    network: network.network,
  })
}
