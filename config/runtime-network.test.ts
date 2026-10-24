import { describe, expect, test } from 'bun:test'

import { loadRuntimeNetwork } from './runtime-network'

const MAINNET_ENV = {
  WAYBILL_NETWORK: 'mainnet',
  WAYBILL_MAINNET_CHAIN_ID: '5042',
  WAYBILL_MAINNET_RPC_URL: 'https://rpc.mainnet.arc.io',
  WAYBILL_MAINNET_EXPLORER_URL: 'https://explorer.arc.io',
  WAYBILL_MAINNET_USDC_ADDRESS: '0x3600000000000000000000000000000000000000',
  WAYBILL_MAINNET_ESCROW_ADDRESS: '0x1111111111111111111111111111111111111111',
  WAYBILL_MAINNET_ARBITER_LIST_ADDRESS: '0x2222222222222222222222222222222222222222',
  WAYBILL_MAINNET_ATTESTOR_REGISTRY_ADDRESS: '0x3333333333333333333333333333333333333333',
  WAYBILL_MAINNET_BOND_VAULT_ADDRESS: '0x4444444444444444444444444444444444444444',
  WAYBILL_MAINNET_FINANCING_VAULT_ADDRESS: '0x5555555555555555555555555555555555555555',
}

describe('loadRuntimeNetwork', () => {
  test('loads the checked-in testnet manifest', () => {
    const network = loadRuntimeNetwork({ WAYBILL_NETWORK: 'testnet' })

    expect(network.network).toBe('testnet')
    expect(network.chainId).toBe(5_042_002)
    expect(network.usdc.decimals).toBe(6)
    expect(network.nativeGasDecimals).toBe(18)
  })

  test('rejects an unset network instead of choosing a default', () => {
    expect(() => loadRuntimeNetwork({})).toThrow('WAYBILL_NETWORK must be explicitly set')
  })

  test('rejects incomplete mainnet configuration', () => {
    expect(() => loadRuntimeNetwork({ WAYBILL_NETWORK: 'mainnet' })).toThrow(
      'Missing required environment variable',
    )
  })

  test('loads a complete mainnet manifest', () => {
    const network = loadRuntimeNetwork(MAINNET_ENV)

    expect(network.network).toBe('mainnet')
    expect(network.chainId).toBe(5042)
    expect(network.contracts.escrow).toBe(MAINNET_ENV.WAYBILL_MAINNET_ESCROW_ADDRESS)
  })

  test('rejects malformed mainnet addresses', () => {
    expect(() =>
      loadRuntimeNetwork({
        ...MAINNET_ENV,
        WAYBILL_MAINNET_ESCROW_ADDRESS: 'not-an-address',
      }),
    ).toThrow('Invalid address for mainnet.contracts.escrow')
  })
})
