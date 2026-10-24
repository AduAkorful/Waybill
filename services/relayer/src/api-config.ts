import type { RuntimeEnvironment } from '@waybill/network/runtime'
import { parseAllowedOrigins } from './api'

export interface ApiConfig {
  port: number
  allowedOrigins: string[]
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
  return { port, allowedOrigins: parseAllowedOrigins(environment.WAYBILL_API_ALLOWED_ORIGINS) }
}
