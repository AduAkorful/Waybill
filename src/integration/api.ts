import type { WaybillNetwork, WaybillNetworkManifest } from '../../config/networks'
import { getBrowserNetwork } from './network'

export type BrowserApiEnvironment = Record<string, string | undefined>

function viteEnvironment(): BrowserApiEnvironment {
  return import.meta.env as BrowserApiEnvironment
}

export function loadBrowserApiBaseUrl(
  environment: BrowserApiEnvironment = viteEnvironment(),
): string {
  const value = environment.VITE_WAYBILL_API_BASE_URL?.trim()
  if (!value) throw new Error('Missing required environment variable: VITE_WAYBILL_API_BASE_URL')

  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('VITE_WAYBILL_API_BASE_URL must be a valid URL')
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('VITE_WAYBILL_API_BASE_URL must use http or https')
  }
  return url.toString().replace(/\/+$/, '')
}

export class WaybillApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string) {
    super(`Waybill API error (${status}): ${code}`)
    this.name = 'WaybillApiError'
    this.status = status
    this.code = code
  }
}

export interface WaybillApiClient {
  getNetwork(): Promise<{ network: WaybillNetwork }>
  getDeal(dealId: bigint): Promise<unknown>
}

export function createWaybillApiClient(
  baseUrl: string,
  fetcher: typeof fetch = fetch,
  network: WaybillNetworkManifest = getBrowserNetwork(),
): WaybillApiClient {
  const root = loadBrowserApiBaseUrl({ VITE_WAYBILL_API_BASE_URL: baseUrl })

  async function getJson<T>(path: string): Promise<T> {
    const response = await fetcher(`${root}${path}`, {
      method: 'GET',
      headers: { accept: 'application/json' },
    })

    let body: unknown
    try {
      body = await response.json()
    } catch {
      throw new WaybillApiError(response.status, 'invalid_json')
    }
    if (!response.ok) {
      const code =
        body && typeof body === 'object' && 'error' in body
          ? String((body as { error: unknown }).error)
          : 'request_failed'
      throw new WaybillApiError(response.status, code)
    }
    return body as T
  }

  return {
    async getNetwork() {
      const result = await getJson<{ network: WaybillNetwork }>('/v1/network')
      if (result.network !== network.network) {
        throw new WaybillApiError(409, 'network_mismatch')
      }
      return result
    },
    async getDeal(dealId) {
      if (dealId < 0n) throw new Error('Deal id cannot be negative')
      return getJson(`/v1/deals/${dealId.toString()}`)
    },
  }
}
