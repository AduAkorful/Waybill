import type { RuntimeEnvironment } from '@waybill/network/runtime'
import { parseAllowedOrigins } from './api'

export interface ApiConfig {
  port: number
  allowedOrigins: string[]
  /** Read-front calls one client may make per minute (heavy calls count 5) */
  rpcPerMinute: number
  /** How many proxies in front of this process append to X-Forwarded-For; the client is that many entries from the end */
  proxyHops: number
}

function wholeNumber(environment: RuntimeEnvironment, name: string, fallback: number, min: number, max: number): number {
  const raw = environment[name]?.trim()
  if (!raw) return fallback
  if (!/^\d+$/.test(raw) || Number(raw) < min || Number(raw) > max) throw new Error(`${name} must be an integer from ${min} to ${max}`)
  return Number(raw)
}

/**
 * The HTTP read API is opt-in: without WAYBILL_API_PORT the process runs the loops only.
 * Origins come from WAYBILL_API_ALLOWED_ORIGINS and are validated, never defaulted.
 */
export function loadApiConfig(environment: RuntimeEnvironment): ApiConfig | null {
  const raw = environment.WAYBILL_API_PORT?.trim()
  if (!raw) return null
  if (!/^\d+$/.test(raw)) throw new Error('WAYBILL_API_PORT must be an integer')
  const port = Number(raw)
  if (port < 1 || port > 65_535) throw new Error('WAYBILL_API_PORT must be between 1 and 65535')
  return {
    port,
    allowedOrigins: parseAllowedOrigins(environment.WAYBILL_API_ALLOWED_ORIGINS),
    rpcPerMinute: wholeNumber(environment, 'WAYBILL_RPC_RATE_PER_MINUTE', 1_200, 10, 100_000),
    proxyHops: wholeNumber(environment, 'WAYBILL_API_PROXY_HOPS', 1, 0, 5),
  }
}
