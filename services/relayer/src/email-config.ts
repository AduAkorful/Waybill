import type { RuntimeEnvironment } from '@waybill/network/runtime'
import { ResendEmailProvider } from './email-resend'

const NAMES = ['WAYBILL_EMAIL_RESEND_API_KEY', 'WAYBILL_EMAIL_FROM', 'WAYBILL_PUBLIC_WEB_URL'] as const

export interface EmailSetup {
  provider: ResendEmailProvider
  webUrl: string
}

/**
 * Email is opt-in and all-or-nothing: with none of its settings no mail is sent and the email routes answer 503,
 * with some missing the process refuses to start.
 */
export function loadEmailSetup(environment: RuntimeEnvironment, fetcher: typeof fetch = fetch): EmailSetup | null {
  const set = NAMES.filter((n) => environment[n]?.trim())
  if (set.length === 0) return null
  const missing = NAMES.filter((n) => !environment[n]?.trim())
  if (missing.length > 0) throw new Error(`Email is partly configured; missing: ${missing.join(', ')}`)
  const webUrl = environment.WAYBILL_PUBLIC_WEB_URL!.trim().replace(/\/+$/, '')
  let parsed: URL
  try {
    parsed = new URL(webUrl)
  } catch {
    throw new Error('WAYBILL_PUBLIC_WEB_URL must be an absolute http(s) URL')
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('WAYBILL_PUBLIC_WEB_URL must be an absolute http(s) URL')
  return {
    webUrl,
    provider: new ResendEmailProvider({ apiKey: environment.WAYBILL_EMAIL_RESEND_API_KEY!.trim(), from: environment.WAYBILL_EMAIL_FROM!.trim(), webUrl }, fetcher),
  }
}
