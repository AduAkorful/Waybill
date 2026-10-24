import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'

import type { WaybillNetwork } from '../../../config/networks'
import type { HealthResult } from './health'

export interface ApiRequest {
  method?: string
  url?: string
}

export interface ApiResponse {
  status: number
  body: unknown
}

export interface WaybillApiOptions {
  network: WaybillNetwork
  health(): Promise<HealthResult>
  readDeal(dealId: bigint): Promise<unknown>
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

function parseDealId(path: string): bigint | null {
  const match = /^\/v1\/deals\/([0-9]+)$/.exec(path)
  if (!match) return null
  return BigInt(match[1]!)
}

export async function handleApiRequest(
  request: ApiRequest,
  options: WaybillApiOptions,
): Promise<ApiResponse> {
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
  if (url.pathname.startsWith('/v1/deals/')) {
    const dealId = parseDealId(url.pathname)
    if (dealId === null) return { status: 400, body: { error: 'invalid_deal_id' } }
    try {
      const deal = await options.readDeal(dealId)
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
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify(result.body))
  })
}
