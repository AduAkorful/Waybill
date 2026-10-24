import { parseUnits } from 'viem'

import type { WaybillNetwork } from '@waybill/network/networks'
import type { RuntimeEnvironment } from '@waybill/network/runtime'
import { EmailAlertSink, WebhookAlertSink, type AlertSink } from './alerts'

export interface AlertConfig {
  sinks: AlertSink[]
  pollIntervalMs: number
  minRelayerGas: bigint
  maxLagBlocks: bigint
  lockedPercent: number
}

const number = (environment: RuntimeEnvironment, name: string, fallback: string, min: number, max: number): number => {
  const text = environment[name]?.trim() || fallback
  if (!/^\d+$/.test(text) || Number(text) < min || Number(text) > max) throw new Error(`${name} must be a whole number from ${min} to ${max}`)
  return Number(text)
}

function webhookUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('WAYBILL_ALERT_WEBHOOK_URL must be an absolute URL')
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) throw new Error('WAYBILL_ALERT_WEBHOOK_URL must use https')
  return url.toString()
}

/**
 * Where operator alerts go and when they fire. On mainnet at least one destination (webhook or email) is required, so
 * a deployment cannot run unwatched; on testnet alerts are still logged when none is set.
 */
export function loadAlertConfig(environment: RuntimeEnvironment, network: WaybillNetwork, fetcher: typeof fetch = fetch): AlertConfig {
  const sinks: AlertSink[] = []
  const hook = environment.WAYBILL_ALERT_WEBHOOK_URL?.trim()
  if (hook) sinks.push(new WebhookAlertSink(webhookUrl(hook), fetcher))

  const to = environment.WAYBILL_ALERT_EMAIL?.trim()
  if (to) {
    const apiKey = environment.WAYBILL_EMAIL_RESEND_API_KEY?.trim()
    const from = environment.WAYBILL_EMAIL_FROM?.trim()
    if (!apiKey || !from) throw new Error('WAYBILL_ALERT_EMAIL needs WAYBILL_EMAIL_RESEND_API_KEY and WAYBILL_EMAIL_FROM')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new Error('WAYBILL_ALERT_EMAIL is not an email address')
    sinks.push(new EmailAlertSink({ apiKey, from, to }, fetcher))
  }
  if (network === 'mainnet' && sinks.length === 0) {
    throw new Error('Mainnet needs WAYBILL_ALERT_WEBHOOK_URL or WAYBILL_ALERT_EMAIL so the operator hears about failures and pauser actions')
  }

  const minGas = environment.WAYBILL_ALERT_MIN_GAS_USDC?.trim() || '5'
  if (!/^\d+(\.\d{1,6})?$/.test(minGas)) throw new Error('WAYBILL_ALERT_MIN_GAS_USDC must be a USDC amount such as 5 or 2.5')

  return {
    sinks,
    pollIntervalMs: number(environment, 'WAYBILL_ALERT_POLL_SECONDS', '60', 10, 3_600) * 1_000,
    // native gas has 18 decimals, unlike the 6-decimal token
    minRelayerGas: parseUnits(minGas, 18),
    maxLagBlocks: BigInt(number(environment, 'WAYBILL_ALERT_MAX_LAG_BLOCKS', '1200', 10, 10_000_000)),
    lockedPercent: number(environment, 'WAYBILL_ALERT_LOCKED_PERCENT', '80', 1, 100),
  }
}
