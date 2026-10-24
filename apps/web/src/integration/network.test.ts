import { describe, expect, test } from 'bun:test'
import { ARC_TESTNET, type WaybillNetworkManifest } from '@waybill/network/networks'
import { loadBrowserNetwork, toViemChain } from './network'

const forkEnvironment = {
  NEXT_PUBLIC_WAYBILL_NETWORK: 'mainnet',
  NEXT_PUBLIC_WAYBILL_LOCAL_FORK: '1',
  NEXT_PUBLIC_WAYBILL_MAINNET_CHAIN_ID: '5042',
  NEXT_PUBLIC_WAYBILL_MAINNET_RPC_URL: 'https://rpc.arc.example',
  NEXT_PUBLIC_WAYBILL_MAINNET_EXPLORER_URL: 'https://explorer.arc.example',
  NEXT_PUBLIC_WAYBILL_MAINNET_USDC_ADDRESS: '0x3600000000000000000000000000000000000000',
  NEXT_PUBLIC_WAYBILL_MAINNET_ESCROW_ADDRESS: '0x1111111111111111111111111111111111111111',
  NEXT_PUBLIC_WAYBILL_MAINNET_ARBITER_LIST_ADDRESS: '0x2222222222222222222222222222222222222222',
  NEXT_PUBLIC_WAYBILL_MAINNET_ATTESTOR_REGISTRY_ADDRESS: '0x3333333333333333333333333333333333333333',
  NEXT_PUBLIC_WAYBILL_MAINNET_BOND_VAULT_ADDRESS: '0x4444444444444444444444444444444444444444',
  NEXT_PUBLIC_WAYBILL_MAINNET_FINANCING_VAULT_ADDRESS: '0x5555555555555555555555555555555555555555',
} as const

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

describe('browser network boundary', () => {
  test('resolves only the checked-in testnet manifest', () => {
    expect(loadBrowserNetwork({ NEXT_PUBLIC_WAYBILL_NETWORK: 'testnet' })).toEqual(ARC_TESTNET)
  })

  test('the local fork requires every mainnet deployment value', () => {
    expect(() =>
      loadBrowserNetwork(
        { NEXT_PUBLIC_WAYBILL_NETWORK: 'mainnet', NEXT_PUBLIC_WAYBILL_LOCAL_FORK: '1', NEXT_PUBLIC_WAYBILL_MAINNET_CHAIN_ID: '5042' },
        null,
      ),
    ).toThrow('Local fork: missing mainnet rpcUrl')
  })

  test('refuses mainnet with no checked-in manifest outside the local fork', () => {
    const { NEXT_PUBLIC_WAYBILL_LOCAL_FORK: _, ...env } = forkEnvironment
    expect(() => loadBrowserNetwork(env, null)).toThrow('No mainnet manifest is checked in')
  })

  test('uses the checked-in mainnet manifest; the RPC may be the same-origin proxy', () => {
    const manifest = loadBrowserNetwork({ NEXT_PUBLIC_WAYBILL_NETWORK: 'mainnet', NEXT_PUBLIC_WAYBILL_MAINNET_RPC_URL: 'https://site.example/rpc' }, CHECKED_IN)
    expect(manifest.contracts.escrow).toBe(CHECKED_IN.contracts.escrow)
    expect(manifest.rpcUrl).toBe('https://site.example/rpc')
    expect(manifest.earlyResolve).toBe(true)
  })

  test('refuses a build whose environment disagrees with the checked-in manifest', () => {
    expect(() =>
      loadBrowserNetwork({ NEXT_PUBLIC_WAYBILL_NETWORK: 'mainnet', NEXT_PUBLIC_WAYBILL_MAINNET_ESCROW_ADDRESS: '0x9999999999999999999999999999999999999999' }, CHECKED_IN),
    ).toThrow('does not match the checked-in manifest')
    expect(() => loadBrowserNetwork({ NEXT_PUBLIC_WAYBILL_NETWORK: 'mainnet', NEXT_PUBLIC_WAYBILL_MAINNET_EARLY_RESOLVE: '0' }, CHECKED_IN)).toThrow('earlyResolve')
  })

  test('does not silently fall back for an unknown or unset switch', () => {
    expect(() => loadBrowserNetwork({})).toThrow('NEXT_PUBLIC_WAYBILL_NETWORK')
    expect(() => loadBrowserNetwork({ NEXT_PUBLIC_WAYBILL_NETWORK: 'staging' })).toThrow(
      'NEXT_PUBLIC_WAYBILL_NETWORK',
    )
  })

  test('creates an Arc chain with native 18-decimal gas metadata', () => {
    const chain = toViemChain(ARC_TESTNET)
    expect(chain.id).toBe(5_042_002)
    expect(chain.nativeCurrency.decimals).toBe(18)
    expect(chain.rpcUrls.default.http).toEqual([ARC_TESTNET.rpcUrl])
  })

  test('the local fork accepts a complete mainnet manifest without importing testnet addresses', () => {
    const manifest = loadBrowserNetwork(forkEnvironment, null)
    expect(manifest.chainId).toBe(5042)
    expect(manifest.contracts.escrow).toBe(forkEnvironment.NEXT_PUBLIC_WAYBILL_MAINNET_ESCROW_ADDRESS)
  })
})
