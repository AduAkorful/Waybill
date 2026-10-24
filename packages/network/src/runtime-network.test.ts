import { describe, expect, test } from 'bun:test'

import type { WaybillNetworkManifest } from './networks'
import { loadRuntimeNetwork } from './runtime-network'

const FORK_ENV = {
  WAYBILL_NETWORK: 'mainnet',
  WAYBILL_LOCAL_FORK: '1',
  WAYBILL_MAINNET_CHAIN_ID: '5042',
  WAYBILL_MAINNET_RPC_URL: 'http://127.0.0.1:8545',
  WAYBILL_MAINNET_EXPLORER_URL: 'https://explorer.arc.io',
  WAYBILL_MAINNET_USDC_ADDRESS: '0x3600000000000000000000000000000000000000',
  WAYBILL_MAINNET_ESCROW_ADDRESS: '0x1111111111111111111111111111111111111111',
  WAYBILL_MAINNET_ARBITER_LIST_ADDRESS: '0x2222222222222222222222222222222222222222',
  WAYBILL_MAINNET_ATTESTOR_REGISTRY_ADDRESS: '0x3333333333333333333333333333333333333333',
  WAYBILL_MAINNET_BOND_VAULT_ADDRESS: '0x4444444444444444444444444444444444444444',
  WAYBILL_MAINNET_FINANCING_VAULT_ADDRESS: '0x5555555555555555555555555555555555555555',
}

const CHECKED_IN: WaybillNetworkManifest = {
  network: 'mainnet',
  chainId: 5042,
  rpcUrl: 'https://rpc.example.org',
  explorerUrl: 'https://explorer.example.org',
  usdc: { address: '0x3600000000000000000000000000000000000000', decimals: 6 },
  nativeGasDecimals: 18,
  contracts: {
    escrow: '0x1111111111111111111111111111111111111111',
    arbiterList: '0x2222222222222222222222222222222222222222',
    attestorRegistry: '0x3333333333333333333333333333333333333333',
    bondVault: '0x4444444444444444444444444444444444444444',
    financingVault: '0x5555555555555555555555555555555555555555',
  },
  multicall3: '0xcA11bde05977b3631167028862bE2a173976CA11',
  escrowDeployBlock: 100n,
  attestorRegistryDeployBlock: 99n,
  arbiterListDeployBlock: 98n,
  earlyResolve: true,
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

  test('refuses mainnet when no manifest is checked in and this is not the local fork', () => {
    const { WAYBILL_LOCAL_FORK: _, ...env } = FORK_ENV
    expect(() => loadRuntimeNetwork(env, undefined)).toThrow('No mainnet manifest is checked in')
  })

  test('the local fork must read a chain on this machine', () => {
    expect(() => loadRuntimeNetwork({ ...FORK_ENV, WAYBILL_MAINNET_RPC_URL: 'https://rpc.example.com' }, undefined)).toThrow('on localhost')
  })

  test('uses the checked-in manifest and lets only the RPC URL be replaced', () => {
    const network = loadRuntimeNetwork({ WAYBILL_NETWORK: 'mainnet', WAYBILL_MAINNET_RPC_URL: 'https://dedicated.example/key' }, CHECKED_IN)
    expect(network.contracts.escrow).toBe(CHECKED_IN.contracts.escrow)
    expect(network.rpcUrl).toBe('https://dedicated.example/key')
    expect(network.escrowDeployBlock).toBe(100n)
  })

  test('accepts environment values that repeat the checked-in ones (any address case)', () => {
    const network = loadRuntimeNetwork({ WAYBILL_NETWORK: 'mainnet', WAYBILL_MAINNET_ESCROW_ADDRESS: CHECKED_IN.contracts.escrow.toUpperCase().replace('0X', '0x'), WAYBILL_MAINNET_CHAIN_ID: '5042' }, CHECKED_IN)
    expect(network.chainId).toBe(5042)
  })

  test('refuses an environment address that differs from the checked-in manifest', () => {
    expect(() =>
      loadRuntimeNetwork({ WAYBILL_NETWORK: 'mainnet', WAYBILL_MAINNET_ESCROW_ADDRESS: '0x9999999999999999999999999999999999999999' }, CHECKED_IN),
    ).toThrow('does not match the checked-in manifest')
    expect(() => loadRuntimeNetwork({ WAYBILL_NETWORK: 'mainnet', WAYBILL_MAINNET_CHAIN_ID: '1' }, CHECKED_IN)).toThrow('chainId')
  })

  test('refuses the local-fork flag next to a checked-in manifest', () => {
    expect(() => loadRuntimeNetwork({ WAYBILL_NETWORK: 'mainnet', WAYBILL_LOCAL_FORK: '1' }, CHECKED_IN)).toThrow('refusing to mix')
  })

  test('refuses a checked-in manifest without deploy blocks, Multicall3 or earlyResolve', () => {
    const { escrowDeployBlock: _, ...incomplete } = CHECKED_IN
    expect(() => loadRuntimeNetwork({ WAYBILL_NETWORK: 'mainnet' }, incomplete)).toThrow('incomplete: escrowDeployBlock')
  })

  test('rejects incomplete mainnet configuration', () => {
    expect(() => loadRuntimeNetwork({ WAYBILL_NETWORK: 'mainnet', WAYBILL_LOCAL_FORK: '1', WAYBILL_MAINNET_RPC_URL: 'http://127.0.0.1:8545' }, undefined)).toThrow(
      'Local fork: missing mainnet chainId',
    )
  })

  test('the local fork loads a complete mainnet manifest from the environment', () => {
    const network = loadRuntimeNetwork(FORK_ENV, undefined)

    expect(network.network).toBe('mainnet')
    expect(network.chainId).toBe(5042)
    expect(network.contracts.escrow).toBe(FORK_ENV.WAYBILL_MAINNET_ESCROW_ADDRESS)
  })

  test('rejects malformed mainnet addresses', () => {
    expect(() =>
      loadRuntimeNetwork({
        ...FORK_ENV,
        WAYBILL_MAINNET_ESCROW_ADDRESS: 'not-an-address',
      }, undefined),
    ).toThrow('Invalid address for mainnet.contracts.escrow')
  })
})
