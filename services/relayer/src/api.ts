import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'

import type { WaybillNetwork } from '@waybill/network/networks'
import type { HealthResult } from './health'

export interface ApiRequest {
  method?: string
  url?: string
  headers?: Record<string, string | string[] | undefined>
}

export interface ApiResponse {
  status: number
  body: unknown
  headers?: Record<string, string>
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
  /** Every deal that names a wallet, with the role it holds in each. */
  listWalletDeals(address: string): Promise<unknown>
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
        'access-control-allow-methods': 'GET',
        'access-control-allow-headers': 'content-type',
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

export function createWaybillApi(options: WaybillApiOptions): Server {
  return createServer(async (request: IncomingMessage, response: ServerResponse) => {
    const result = await handleApiRequest(request, options)
    response.statusCode = result.status
    for (const [name, value] of Object.entries(result.headers ?? {})) response.setHeader(name, value)
    if (result.body === null) return response.end()
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify(result.body))
  })
}
