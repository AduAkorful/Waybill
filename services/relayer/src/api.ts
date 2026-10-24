import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'

import type { WaybillNetwork } from '@waybill/network/networks'
import { EvidenceError, MAX_EVIDENCE_BYTES, type EvidenceService } from './evidence-service'
import type { HealthResult } from './health'

export interface ApiRequest {
  method?: string
  url?: string
  headers?: Record<string, string | string[] | undefined>
  /** Raw request body, present only for the evidence upload route */
  body?: Uint8Array
}

export interface ApiResponse {
  status: number
  body: unknown
  headers?: Record<string, string>
  /** Raw bytes to send instead of JSON (evidence download) */
  bytes?: Uint8Array
}

export interface WaybillApiOptions {
  network: WaybillNetwork
  /** Exact browser origins allowed to call this API. Empty means no cross-origin access. */
  allowedOrigins?: readonly string[]
  health(): Promise<HealthResult>
  readDeal(dealId: bigint): Promise<unknown>
  /** Indexed events for one deal, oldest first. */
  readDealEvents(dealId: bigint): Promise<unknown>
  /** Every attestor with a presence in the registry, with live registry state. */
  listAttestors(): Promise<unknown>
  /** One attestor with live registry state and registry history, or null when the address is unknown. */
  readAttestor(address: string): Promise<unknown | null>
  /** Monitor figures for the operator console: live chain state plus aggregates over the index. */
  operatorSummary?(): Promise<unknown>
  /** Every arbiter with a presence on the approved list, with live list state. */
  listArbiters?(): Promise<unknown>
  /** Every deal that names a wallet, with the role it holds in each. */
  listWalletDeals(address: string): Promise<unknown>
  /** Evidence upload, listing and download for deal parties. Absent when no storage is configured. */
  evidence?: EvidenceService | null
}

function jsonValue(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString()
  if (Array.isArray(value)) return value.map(jsonValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, child]) => [
        key,
        jsonValue(child),
      ]),
    )
  }
  return value
}

function parseDealRoute(path: string): { dealId: bigint; events: boolean } | null {
  const match = /^\/v1\/deals\/([0-9]+)(\/events)?$/.exec(path)
  if (!match) return null
  return { dealId: BigInt(match[1]!), events: match[2] !== undefined }
}

/**
 * Parses WAYBILL_API_ALLOWED_ORIGINS: comma-separated exact origins such as
 * https://app.waybill.example. Wildcards, paths and non-http(s) schemes are rejected so a
 * typo cannot silently open the API to every site.
 */
export function parseAllowedOrigins(raw: string | undefined): string[] {
  if (!raw || raw.trim() === '') return []
  const origins = raw.split(',').map((item) => item.trim()).filter((item) => item !== '')
  for (const origin of origins) {
    let parsed: URL
    try {
      parsed = new URL(origin)
    } catch {
      throw new Error(`Invalid allowed origin: ${origin}`)
    }
    if (
      (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') ||
      parsed.origin !== origin
    ) {
      throw new Error(`Allowed origin must be an exact http(s) origin: ${origin}`)
    }
  }
  return [...new Set(origins)]
}

function headerValue(request: ApiRequest, name: string): string | undefined {
  const value = request.headers?.[name]
  return Array.isArray(value) ? value[0] : value
}

export async function handleApiRequest(
  request: ApiRequest,
  options: WaybillApiOptions,
): Promise<ApiResponse> {
  const allowed = options.allowedOrigins ?? []
  const origin = headerValue(request, 'origin')
  // Browsers always send Origin cross-origin; an origin we have not listed is refused outright
  // rather than served without CORS headers.
  if (origin !== undefined && !allowed.includes(origin)) {
    return { status: 403, body: { error: 'origin_not_allowed' }, headers: { vary: 'Origin' } }
  }
  const cors: Record<string, string> =
    origin === undefined ? {} : { 'access-control-allow-origin': origin, vary: 'Origin' }
  if (request.method === 'OPTIONS') {
    if (origin === undefined) return { status: 405, body: { error: 'method_not_allowed' } }
    return {
      status: 204,
      body: null,
      headers: {
        ...cors,
        'access-control-allow-methods': 'GET, POST',
        'access-control-allow-headers': 'content-type, x-waybill-signer, x-waybill-signature, x-waybill-signed-at, x-waybill-files, x-waybill-file-name',
        'access-control-max-age': '600',
      },
    }
  }
  const result = await route(request, options)
  const headers = { ...cors, ...result.headers }
  return Object.keys(headers).length === 0 ? result : { ...result, headers }
}

async function route(request: ApiRequest, options: WaybillApiOptions): Promise<ApiResponse> {
  let url: URL
  try {
    url = new URL(request.url ?? '/', 'http://waybill.local')
  } catch {
    return { status: 400, body: { error: 'invalid_request_url' } }
  }
  const evidenceRoute = /^\/v1\/deals\/([0-9]+)\/evidence(?:\/([0-9a-fA-F-]{36}|[0-9]{1,3}))?$/.exec(url.pathname)
  if (evidenceRoute) return evidence(request, options, BigInt(evidenceRoute[1]!), evidenceRoute[2])
  if (request.method !== 'GET') return { status: 405, body: { error: 'method_not_allowed' } }
  if (url.pathname === '/health') {
    return { status: 200, body: await options.health() }
  }
  if (url.pathname === '/v1/network') {
    return { status: 200, body: { network: options.network } }
  }
  if (url.pathname.startsWith('/v1/wallets/')) {
    const match = /^\/v1\/wallets\/(0x[0-9a-fA-F]{40})\/deals$/.exec(url.pathname)
    if (!match) return { status: 400, body: { error: 'invalid_address' } }
    try {
      return { status: 200, body: jsonValue(await options.listWalletDeals(match[1]!)) }
    } catch {
      return { status: 503, body: { error: 'wallet_deals_unavailable' } }
    }
  }
  if (url.pathname === '/v1/operator') {
    if (!options.operatorSummary) return { status: 503, body: { error: 'operator_summary_unavailable' } }
    try {
      return { status: 200, body: jsonValue(await options.operatorSummary()) }
    } catch {
      return { status: 503, body: { error: 'operator_summary_unavailable' } }
    }
  }
  if (url.pathname === '/v1/arbiters') {
    if (!options.listArbiters) return { status: 503, body: { error: 'arbiters_unavailable' } }
    try {
      return { status: 200, body: jsonValue(await options.listArbiters()) }
    } catch {
      return { status: 503, body: { error: 'arbiters_unavailable' } }
    }
  }
  if (url.pathname === '/v1/attestors') {
    try {
      return { status: 200, body: jsonValue(await options.listAttestors()) }
    } catch {
      return { status: 503, body: { error: 'attestors_unavailable' } }
    }
  }
  if (url.pathname.startsWith('/v1/attestors/')) {
    const address = url.pathname.slice('/v1/attestors/'.length)
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return { status: 400, body: { error: 'invalid_address' } }
    try {
      const attestor = await options.readAttestor(address)
      if (attestor === null) return { status: 404, body: { error: 'unknown_attestor' } }
      return { status: 200, body: jsonValue(attestor) }
    } catch {
      return { status: 503, body: { error: 'attestors_unavailable' } }
    }
  }
  if (url.pathname.startsWith('/v1/deals/')) {
    const parsed = parseDealRoute(url.pathname)
    if (parsed === null) return { status: 400, body: { error: 'invalid_deal_id' } }
    if (parsed.events) {
      try {
        return { status: 200, body: jsonValue(await options.readDealEvents(parsed.dealId)) }
      } catch {
        return { status: 503, body: { error: 'events_unavailable' } }
      }
    }
    try {
      const deal = await options.readDeal(parsed.dealId)
      return { status: 200, body: jsonValue(deal) }
    } catch {
      return { status: 503, body: { error: 'chain_read_unavailable' } }
    }
  }
  return { status: 404, body: { error: 'not_found' } }
}

function signedRequest(request: ApiRequest): { signer: string; signature: string; signedAt: number; files: string[] } | null {
  const signer = headerValue(request, 'x-waybill-signer')
  const signature = headerValue(request, 'x-waybill-signature')
  const signedAt = headerValue(request, 'x-waybill-signed-at')
  if (!signer || !signature || !signedAt || !/^\d+$/.test(signedAt)) return null
  const files = (headerValue(request, 'x-waybill-files') ?? '').split(',').map((f) => f.trim()).filter((f) => f !== '')
  return { signer, signature, signedAt: Number(signedAt), files }
}

async function evidence(request: ApiRequest, options: WaybillApiOptions, dealId: bigint, tail: string | undefined): Promise<ApiResponse> {
  const service = options.evidence
  if (!service) return { status: 503, body: { error: 'evidence_unavailable' } }
  const signed = signedRequest(request)
  if (!signed) return { status: 401, body: { error: 'missing_signature' } }
  try {
    if (request.method === 'POST' && tail !== undefined && /^[0-9]{1,3}$/.test(tail)) {
      const contentType = headerValue(request, 'content-type') ?? ''
      const rawName = headerValue(request, 'x-waybill-file-name')
      let fileName: string | null = null
      if (rawName) {
        try {
          fileName = decodeURIComponent(rawName).slice(0, 200)
        } catch {
          return { status: 400, body: { error: 'invalid_file_name' } }
        }
      }
      const result = await service.upload({
        dealId,
        part: Number(tail),
        signed,
        files: signed.files,
        bytes: request.body ?? new Uint8Array(),
        mimeType: /^[\w.+-]+\/[\w.+-]+$/.test(contentType) ? contentType : 'application/octet-stream',
        fileName,
      })
      return { status: 201, body: result }
    }
    if (request.method === 'GET' && tail === undefined) return { status: 200, body: await service.list(dealId, signed) }
    if (request.method === 'GET' && tail !== undefined && tail.length === 36) {
      const file = await service.download(dealId, tail, signed)
      return {
        status: 200,
        body: null,
        bytes: file.bytes,
        headers: {
          'content-type': file.mimeType,
          'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName ?? 'evidence')}`,
          'x-content-type-options': 'nosniff',
        },
      }
    }
    return { status: 405, body: { error: 'method_not_allowed' } }
  } catch (e) {
    if (e instanceof EvidenceError) return { status: e.status, body: { error: e.code } }
    return { status: 503, body: { error: 'evidence_unavailable' } }
  }
}

export function createWaybillApi(options: WaybillApiOptions): Server {
  return createServer(async (request: IncomingMessage, response: ServerResponse) => {
    let body: Uint8Array | undefined
    if (request.method === 'POST') {
      const chunks: Buffer[] = []
      let size = 0
      for await (const chunk of request) {
        size += (chunk as Buffer).length
        if (size > MAX_EVIDENCE_BYTES + 1024) {
          response.statusCode = 413
          response.setHeader('content-type', 'application/json')
          return response.end(JSON.stringify({ error: 'file_too_large' }))
        }
        chunks.push(chunk as Buffer)
      }
      body = Buffer.concat(chunks)
    }
    const result = await handleApiRequest(Object.assign(request, body ? { body } : {}), options)
    response.statusCode = result.status
    for (const [name, value] of Object.entries(result.headers ?? {})) response.setHeader(name, value)
    if (result.bytes) return response.end(Buffer.from(result.bytes))
    if (result.body === null) return response.end()
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify(result.body))
  })
}
