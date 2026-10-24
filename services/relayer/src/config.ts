import {
  loadRuntimeNetwork,
  type RuntimeEnvironment,
} from '@waybill/network/runtime'
import type { WaybillNetworkManifest } from '@waybill/network/networks'

export const RELAYER_OPERATIONS = ['claim', 'refund', 'applyDefault'] as const
export type RelayerOperation = (typeof RELAYER_OPERATIONS)[number]
export type RelayerPrivateKey = `0x${string}`

export interface RelayerConfig {
  network: WaybillNetworkManifest
  privateKey: RelayerPrivateKey
  startBlock: bigint
  maxBlockRange: bigint
  pollIntervalMs: number
  confirmations: 1
  operations: readonly RelayerOperation[]
}

const DEFAULT_POLL_INTERVAL_MS = 15_000
const MIN_POLL_INTERVAL_MS = 1_000
const MAX_POLL_INTERVAL_MS = 5 * 60_000
const MIN_BLOCK_RANGE = 1n
const MAX_BLOCK_RANGE = 10_000n

function required(environment: RuntimeEnvironment, name: string): string {
  const value = environment[name]?.trim()
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

function parseInteger(value: string, name: string): number {
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be a non-negative integer`)
  return Number(value)
}

function parseBlock(value: string, name: string): bigint {
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be a non-negative integer`)
  return BigInt(value)
}

function parsePrivateKey(value: string): RelayerPrivateKey {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error('WAYBILL_RELAYER_PRIVATE_KEY must be a 32-byte hex key')
  }
  return value as RelayerPrivateKey
}

export function loadRelayerConfig(environment: RuntimeEnvironment): RelayerConfig {
  const startBlock = parseBlock(
    required(environment, 'WAYBILL_RELAYER_START_BLOCK'),
    'WAYBILL_RELAYER_START_BLOCK',
  )
  const maxBlockRange = environment.WAYBILL_RELAYER_MAX_BLOCK_RANGE
    ? parseBlock(environment.WAYBILL_RELAYER_MAX_BLOCK_RANGE, 'WAYBILL_RELAYER_MAX_BLOCK_RANGE')
    : 2_000n
  if (maxBlockRange < MIN_BLOCK_RANGE || maxBlockRange > MAX_BLOCK_RANGE) {
    throw new Error(
      `WAYBILL_RELAYER_MAX_BLOCK_RANGE must be between ${MIN_BLOCK_RANGE} and ${MAX_BLOCK_RANGE}`,
    )
  }
  const pollIntervalMs = environment.WAYBILL_RELAYER_POLL_INTERVAL_MS
    ? parseInteger(environment.WAYBILL_RELAYER_POLL_INTERVAL_MS, 'WAYBILL_RELAYER_POLL_INTERVAL_MS')
    : DEFAULT_POLL_INTERVAL_MS
  if (pollIntervalMs < MIN_POLL_INTERVAL_MS || pollIntervalMs > MAX_POLL_INTERVAL_MS) {
    throw new Error(
      `WAYBILL_RELAYER_POLL_INTERVAL_MS must be between ${MIN_POLL_INTERVAL_MS} and ${MAX_POLL_INTERVAL_MS}`,
    )
  }

  const confirmations = environment.WAYBILL_RELAYER_CONFIRMATIONS
    ? parseInteger(environment.WAYBILL_RELAYER_CONFIRMATIONS, 'WAYBILL_RELAYER_CONFIRMATIONS')
    : 1
  if (confirmations !== 1) {
    throw new Error('WAYBILL_RELAYER_CONFIRMATIONS must be 1')
  }

  return {
    network: loadRuntimeNetwork(environment),
    privateKey: parsePrivateKey(required(environment, 'WAYBILL_RELAYER_PRIVATE_KEY')),
    startBlock,
    maxBlockRange,
    pollIntervalMs,
    confirmations: 1,
    operations: RELAYER_OPERATIONS,
  }
}
