import { createHash, createHmac } from 'node:crypto'
import type { ObjectStore } from './evidence-storage'

export interface S3Credentials {
  accessKeyId: string
  secretAccessKey: string
}

const sha256Hex = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex')
const hmac = (key: string | Buffer, data: string) => createHmac('sha256', key).update(data).digest()

const encodePath = (path: string) =>
  path
    .split('/')
    .map((part) => encodeURIComponent(part).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join('/')

/**
 * AWS Signature Version 4 for one request. `headers` are every header to be signed (lower-case names), including
 * host, x-amz-content-sha256 and x-amz-date. Returns the Authorization header value.
 */
export function signV4(input: {
  method: string
  path: string
  query?: string
  headers: Record<string, string>
  payloadHash: string
  region: string
  service: string
  amzDate: string
  credentials: S3Credentials
}): string {
  const names = Object.keys(input.headers).map((n) => n.toLowerCase()).sort()
  const canonicalHeaders = names.map((n) => `${n}:${input.headers[n]!.trim().replace(/\s+/g, ' ')}\n`).join('')
  const signedHeaders = names.join(';')
  const canonicalRequest = [input.method, encodePath(input.path), input.query ?? '', canonicalHeaders, signedHeaders, input.payloadHash].join('\n')
  const day = input.amzDate.slice(0, 8)
  const scope = `${day}/${input.region}/${input.service}/aws4_request`
  const toSign = ['AWS4-HMAC-SHA256', input.amzDate, scope, sha256Hex(canonicalRequest)].join('\n')
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${input.credentials.secretAccessKey}`, day), input.region), input.service), 'aws4_request')
  const signature = createHmac('sha256', signingKey).update(toSign).digest('hex')
  return `AWS4-HMAC-SHA256 Credential=${input.credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
}

export interface S3Config {
  /** https://… endpoint of an S3-compatible service, no bucket and no trailing slash */
  endpoint: string
  bucket: string
  region: string
  credentials: S3Credentials
}

/** Path-style S3 client over fetch, enough for put, get and delete of one object. Works with S3, R2 and Backblaze. */
export class S3ObjectStore implements ObjectStore {
  constructor(
    private readonly config: S3Config,
    private readonly fetcher: typeof fetch = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (!/^https:\/\/[^/]+$/.test(config.endpoint)) throw new Error('S3 endpoint must be an https origin with no path')
    if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(config.bucket)) throw new Error('S3 bucket name is invalid')
  }

  private async request(method: string, key: string, body?: Uint8Array, mimeType?: string): Promise<Response> {
    const path = `/${this.config.bucket}/${key}`
    const host = new URL(this.config.endpoint).host
    const amzDate = this.now().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
    const payloadHash = sha256Hex(body ?? '')
    const headers: Record<string, string> = { host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate }
    if (mimeType) headers['content-type'] = mimeType
    const authorization = signV4({ method, path, headers, payloadHash, region: this.config.region, service: 's3', amzDate, credentials: this.config.credentials })
    const { host: _host, ...sendHeaders } = headers
    return this.fetcher(`${this.config.endpoint}${encodePath(path)}`, {
      method,
      headers: { ...sendHeaders, authorization },
      ...(body ? { body: new Uint8Array(body) } : {}),
    })
  }

  async put(input: { key: string; bytes: Uint8Array; mimeType: string }): Promise<{ uri: string }> {
    const response = await this.request('PUT', input.key, input.bytes, input.mimeType)
    if (!response.ok) throw new Error(`Object store rejected the upload (${response.status})`)
    return { uri: `s3://${this.config.bucket}/${input.key}` }
  }

  async get(uri: string): Promise<Uint8Array> {
    const response = await this.request('GET', this.keyOf(uri))
    if (!response.ok) throw new Error(`Object store could not read the file (${response.status})`)
    return new Uint8Array(await response.arrayBuffer())
  }

  async remove(uri: string): Promise<void> {
    const response = await this.request('DELETE', this.keyOf(uri))
    if (!response.ok && response.status !== 404) throw new Error(`Object store could not remove the file (${response.status})`)
  }

  private keyOf(uri: string): string {
    const prefix = `s3://${this.config.bucket}/`
    if (!uri.startsWith(prefix)) throw new Error('Evidence URI is not in the configured bucket')
    return uri.slice(prefix.length)
  }
}
