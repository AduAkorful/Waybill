import { describe, expect, test } from 'bun:test'

import {
  loadRelayerConfig,
  RELAYER_OPERATIONS,
} from './config'

const VALID_ENV = {
  WAYBILL_NETWORK: 'testnet',
  WAYBILL_RELAYER_PRIVATE_KEY: `0x${'11'.repeat(32)}`,
}

describe('loadRelayerConfig', () => {
  test('loads the fixed gas-only operation set', () => {
    const config = loadRelayerConfig(VALID_ENV)

    expect(config.network.network).toBe('testnet')
    expect(config.pollIntervalMs).toBe(15_000)
    expect(config.confirmations).toBe(1)
    expect(config.operations).toEqual(RELAYER_OPERATIONS)
  })

  test('rejects a missing or malformed relayer key', () => {
    expect(() => loadRelayerConfig({ WAYBILL_NETWORK: 'testnet' })).toThrow(
      'Missing required environment variable',
    )
    expect(() =>
      loadRelayerConfig({
        ...VALID_ENV,
        WAYBILL_RELAYER_PRIVATE_KEY: '0x1234',
      }),
    ).toThrow('must be a 32-byte hex key')
  })

  test('rejects unsafe polling intervals', () => {
    expect(() =>
      loadRelayerConfig({
        ...VALID_ENV,
        WAYBILL_RELAYER_POLL_INTERVAL_MS: '999',
      }),
    ).toThrow('must be between')
    expect(() =>
      loadRelayerConfig({
        ...VALID_ENV,
        WAYBILL_RELAYER_POLL_INTERVAL_MS: 'not-a-number',
      }),
    ).toThrow('must be a non-negative integer')
  })

  test('requires one confirmation', () => {
    expect(() =>
      loadRelayerConfig({
        ...VALID_ENV,
        WAYBILL_RELAYER_CONFIRMATIONS: '0',
      }),
    ).toThrow('must be 1')
    expect(() =>
      loadRelayerConfig({
        ...VALID_ENV,
        WAYBILL_RELAYER_CONFIRMATIONS: '2',
      }),
    ).toThrow('must be 1')
  })
})
