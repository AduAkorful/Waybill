import type { WaybillNetwork, WaybillNetworkManifest } from '@waybill/network/networks'
import { publicEnvironment } from './env'
import { getBrowserNetwork } from './network'

export type BrowserApiEnvironment = Record<string, string | undefined>

export function loadBrowserApiBaseUrl(
  environment: BrowserApiEnvironment = publicEnvironment(),
): string {
  const value = environment.NEXT_PUBLIC_WAYBILL_API_BASE_URL?.trim()
  if (!value) throw new Error('Missing required environment variable: NEXT_PUBLIC_WAYBILL_API_BASE_URL')

  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('NEXT_PUBLIC_WAYBILL_API_BASE_URL must be a valid URL')
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('NEXT_PUBLIC_WAYBILL_API_BASE_URL must use http or https')
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
  /** Indexed events for one deal, oldest first, exactly as the relayer serves them */
  getDealEvents(dealId: bigint): Promise<unknown>
  /** Every attestor in the registry, with live registry state */
  getAttestors(): Promise<unknown>
  /** One attestor with registry history; rejects with a 404 WaybillApiError when unknown */
  getAttestor(address: string): Promise<unknown>
  /** Monitor figures for the operator console */
  getOperatorSummary(): Promise<unknown>
  /** Every arbiter on or heading to the approved list, with live list state */
  getArbiters(): Promise<unknown>
  /** Every deal that names a wallet, newest first, with the roles it holds in each */
  getWalletDeals(address: string): Promise<unknown>
}

export function createWaybillApiClient(
  baseUrl: string,
  fetcher: typeof fetch = fetch,
  network: WaybillNetworkManifest = getBrowserNetwork(),
): WaybillApiClient {
  const root = loadBrowserApiBaseUrl({ NEXT_PUBLIC_WAYBILL_API_BASE_URL: baseUrl })

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
    async getDealEvents(dealId) {
      if (dealId < 0n) throw new Error('Deal id cannot be negative')
      return getJson(`/v1/deals/${dealId.toString()}/events`)
    },
    async getAttestors() {
      return getJson('/v1/attestors')
    },
    async getOperatorSummary() {
      return getJson('/v1/operator')
    },
    async getArbiters() {
      return getJson('/v1/arbiters')
    },
    async getWalletDeals(address) {
      if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error('Invalid wallet address')
      return getJson(`/v1/wallets/${address}/deals`)
    },
    async getAttestor(address) {
      if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error('Invalid attestor address')
      return getJson(`/v1/attestors/${address}`)
    },
  }
}
