import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import type { IpfsPinner, ObjectStore } from './evidence-storage'

/**
 * Dev and local-fork only: keeps the (already encrypted) evidence on this machine's disk instead of S3 and Pinata.
 * It is refused unless the chain RPC is on this machine, so a testnet or mainnet relayer can never fall back to it.
 */
export function assertLocalEvidenceAllowed(rpcUrl: string, environment: { NODE_ENV?: string }): void {
  let host = ''
  try {
    host = new URL(rpcUrl).hostname
  } catch {
    // an unparsable RPC URL is never treated as local
  }
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) {
    throw new Error('WAYBILL_EVIDENCE_LOCAL_DIR is only allowed when the chain RPC is on this machine (a dev fork)')
  }
  if (environment.NODE_ENV === 'production') throw new Error('WAYBILL_EVIDENCE_LOCAL_DIR is not allowed with NODE_ENV=production')
}

/**
 * Local objects are recorded as s3://waybill-localdev/<key>. The pointer table (and its CHECK constraint) only accept
 * http(s) and s3 URIs, so this keeps the production schema untouched; the reserved bucket name marks it as dev-only.
 */
export const LOCAL_EVIDENCE_URI_PREFIX = 's3://waybill-localdev/'

export class LocalDirObjectStore implements ObjectStore {
  private readonly root: string
  constructor(dir: string) {
    this.root = resolve(dir)
  }

  private pathOf(key: string): string {
    const path = resolve(this.root, key)
    if (path !== this.root && !path.startsWith(this.root + sep)) throw new Error('Evidence key escapes the local directory')
    return path
  }

  async put(input: { key: string; bytes: Uint8Array; mimeType: string }): Promise<{ uri: string }> {
    const path = this.pathOf(input.key)
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, input.bytes)
    return { uri: LOCAL_EVIDENCE_URI_PREFIX + input.key }
  }

  private fromUri(uri: string): string {
    if (!uri.startsWith(LOCAL_EVIDENCE_URI_PREFIX)) throw new Error('Evidence URI is not a local dev object')
    return this.pathOf(uri.slice(LOCAL_EVIDENCE_URI_PREFIX.length))
  }

  async get(uri: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(this.fromUri(uri)))
  }

  async remove(uri: string): Promise<void> {
    await rm(this.fromUri(uri), { force: true })
  }
}

/** Stands in for Pinata on a dev fork: a content-derived local id, clearly marked so it is never mistaken for a real CID. */
export class LocalPinner implements IpfsPinner {
  async pin(input: { bytes: Uint8Array; mimeType: string }): Promise<{ uri: string }> {
    return { uri: `ipfs://localdev${createHash('sha256').update(input.bytes).digest('hex')}` }
  }
}
