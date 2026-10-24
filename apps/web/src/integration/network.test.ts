import { describe, expect, test } from 'bun:test'
import { ARC_TESTNET } from '@waybill/network/networks'
import { loadBrowserNetwork, toViemChain } from './network'

const mainnetEnvironment = {
  NEXT_PUBLIC_WAYBILL_NETWORK: 'mainnet',
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

describe('browser network boundary', () => {
  test('resolves only the checked-in testnet manifest', () => {
    expect(loadBrowserNetwork({ NEXT_PUBLIC_WAYBILL_NETWORK: 'testnet' })).toEqual(ARC_TESTNET)
  })

  test('requires every mainnet deployment value', () => {
    expect(() =>
      loadBrowserNetwork({
        NEXT_PUBLIC_WAYBILL_NETWORK: 'mainnet',
        NEXT_PUBLIC_WAYBILL_MAINNET_CHAIN_ID: '5042',
      }),
    ).toThrow('NEXT_PUBLIC_WAYBILL_MAINNET_RPC_URL')
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

  test('accepts a complete mainnet manifest without importing testnet addresses', () => {
    const manifest = loadBrowserNetwork(mainnetEnvironment)
    expect(manifest.chainId).toBe(5042)
    expect(manifest.contracts.escrow).toBe(mainnetEnvironment.NEXT_PUBLIC_WAYBILL_MAINNET_ESCROW_ADDRESS)
  })
})
