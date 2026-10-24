import { keccak256, type Hex } from 'viem'
import { loadBrowserApiBaseUrl } from './api'
import { getBrowserNetwork } from './network'

/** One file's SHA-256, as 0x hex. This is the digest the wallet signs and the relayer verifies. */
export async function sha256Hex(bytes: Uint8Array): Promise<Hex> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)))
  return `0x${Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('')}`
}

/**
 * The 32 bytes recorded on-chain with a dispute: keccak256 of every file's SHA-256 digest, in the order given.
 * Anyone holding the same files in the same order can recompute it.
 */
export function evidenceCommitment(digests: readonly Hex[]): Hex {
  if (digests.length < 1) throw new Error('A dispute needs at least one piece of evidence')
  return keccak256(`0x${digests.map((d) => d.slice(2)).join('')}` as Hex)
}

/** The exact text the wallet signs. Must match the relayer's evidenceMessage character for character. */
export function evidenceMessage(input: {
  network: string
  chainId: number
  escrow: string
  dealId: bigint
  action: 'upload' | 'read'
  signedAt: number
  part: number | null
  files: readonly string[]
}): string {
  return [
    'Waybill evidence',
    `action: ${input.action}`,
    `network: ${input.network}`,
    `chain: ${input.chainId}`,
    `escrow: ${input.escrow.toLowerCase()}`,
    `deal: ${input.dealId}`,
    `part: ${input.part === null ? 'all' : input.part}`,
    `files: ${input.files.map((f) => f.toLowerCase()).join(',')}`,
    `signed: ${input.signedAt}`,
  ].join('\n')
}

export interface EvidenceFile {
  name: string
  mimeType: string
  bytes: Uint8Array
  sha256: Hex
}

export async function readFile(file: File): Promise<EvidenceFile> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  return { name: file.name, mimeType: file.type || 'application/octet-stream', bytes, sha256: await sha256Hex(bytes) }
}

export type SignText = (message: string) => Promise<Hex>

export class EvidenceUploadError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code)
  }
}

/**
 * Uploads every file with one wallet signature that covers the whole list. Returns the commitment to record on-chain.
 * Throws on the first failure; nothing is reported as filed unless every file was stored.
 */
export async function uploadEvidence(input: {
  dealId: bigint
  part: number
  signer: string
  files: readonly EvidenceFile[]
  sign: SignText
  fetcher?: typeof fetch
  now?: () => number
}): Promise<Hex> {
  const network = getBrowserNetwork()
  const base = loadBrowserApiBaseUrl()
  const fetcher = input.fetcher ?? fetch
  const digests = input.files.map((f) => f.sha256)
  const signedAt = (input.now ?? (() => Math.floor(Date.now() / 1000)))()
  const signature = await input.sign(
    evidenceMessage({
      network: network.network,
      chainId: network.chainId,
      escrow: network.contracts.escrow,
      dealId: input.dealId,
      action: 'upload',
      signedAt,
      part: input.part,
      files: digests,
    }),
  )
  for (const file of input.files) {
    const response = await fetcher(`${base}/v1/deals/${input.dealId}/evidence/${input.part}`, {
      method: 'POST',
      headers: {
        'content-type': file.mimeType,
        'x-waybill-signer': input.signer,
        'x-waybill-signature': signature,
        'x-waybill-signed-at': String(signedAt),
        'x-waybill-files': digests.join(','),
        'x-waybill-file-name': encodeURIComponent(file.name),
      },
      body: new Uint8Array(file.bytes),
    })
    if (!response.ok) {
      let code = `http_${response.status}`
      try {
        const body = (await response.json()) as { error?: unknown }
        if (typeof body.error === 'string') code = body.error
      } catch {
        // keep the status-based code
      }
      throw new EvidenceUploadError(code, response.status)
    }
  }
  return evidenceCommitment(digests)
}

const MESSAGES: Record<string, string> = {
  evidence_unavailable: "This site's evidence storage is not set up yet, so a dispute cannot be filed.",
  not_a_party: 'This wallet is not named in the deal.',
  signature_expired: 'The signature took too long. Try again.',
  file_too_large: 'A file is larger than 10 MB.',
  missing_signature: 'The upload was not signed.',
}

export function describeUploadError(error: unknown): string {
  if (error instanceof EvidenceUploadError) return MESSAGES[error.code] ?? `The upload was refused (${error.code}).`
  return error instanceof Error ? error.message : String(error)
}

export interface StoredEvidence {
  id: string
  part: number
  fileName: string | null
  mimeType: string
  byteSize: number
  sha256: Hex
  uploadedBy: string
  uploadedAt: number | null
}

async function signedReadHeaders(dealId: bigint, signer: string, sign: SignText, now: () => number): Promise<Record<string, string>> {
  const network = getBrowserNetwork()
  const signedAt = now()
  const signature = await sign(
    evidenceMessage({ network: network.network, chainId: network.chainId, escrow: network.contracts.escrow, dealId, action: 'read', signedAt, part: null, files: [] }),
  )
  return { 'x-waybill-signer': signer, 'x-waybill-signature': signature, 'x-waybill-signed-at': String(signedAt) }
}

async function failure(response: Response): Promise<EvidenceUploadError> {
  let code = `http_${response.status}`
  try {
    const body = (await response.json()) as { error?: unknown }
    if (typeof body.error === 'string') code = body.error
  } catch {
    // keep the status-based code
  }
  return new EvidenceUploadError(code, response.status)
}

/** A reader the parties of a deal can use to list and open its evidence. One signature covers every call it makes in a few minutes. */
export function evidenceReader(input: { dealId: bigint; signer: string; sign: SignText; fetcher?: typeof fetch; now?: () => number }) {
  const base = loadBrowserApiBaseUrl()
  const fetcher = input.fetcher ?? fetch
  const now = input.now ?? (() => Math.floor(Date.now() / 1000))
  let headers: Promise<Record<string, string>> | null = null
  const auth = () => (headers ??= signedReadHeaders(input.dealId, input.signer, input.sign, now))
  return {
    async list(): Promise<StoredEvidence[]> {
      const response = await fetcher(`${base}/v1/deals/${input.dealId}/evidence`, { headers: await auth() })
      if (!response.ok) throw await failure(response)
      const rows = (await response.json()) as Record<string, unknown>[]
      return rows.map((r) => ({
        id: String(r.id),
        part: Number(r.part),
        fileName: typeof r.fileName === 'string' ? r.fileName : null,
        mimeType: String(r.mimeType),
        byteSize: Number(r.byteSize),
        sha256: String(r.sha256) as Hex,
        uploadedBy: String(r.uploadedBy),
        uploadedAt: typeof r.uploadedAt === 'number' ? r.uploadedAt : null,
      }))
    },
    async download(id: string): Promise<Blob> {
      const response = await fetcher(`${base}/v1/deals/${input.dealId}/evidence/${id}`, { headers: await auth() })
      if (!response.ok) throw await failure(response)
      return response.blob()
    },
  }
}
