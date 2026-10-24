import { defineChain, type Chain } from 'viem'
import {
  ARC_TESTNET,
  resolveWaybillNetwork,
  type WaybillNetwork,
  type WaybillNetworkManifest,
} from '../../config/networks'

export type BrowserEnvironment = Record<string, string | undefined>

const MAINNET_VARIABLES = {
  chainId: 'VITE_WAYBILL_MAINNET_CHAIN_ID',
  rpcUrl: 'VITE_WAYBILL_MAINNET_RPC_URL',
  explorerUrl: 'VITE_WAYBILL_MAINNET_EXPLORER_URL',
  usdcAddress: 'VITE_WAYBILL_MAINNET_USDC_ADDRESS',
  escrowAddress: 'VITE_WAYBILL_MAINNET_ESCROW_ADDRESS',
  arbiterListAddress: 'VITE_WAYBILL_MAINNET_ARBITER_LIST_ADDRESS',
  attestorRegistryAddress: 'VITE_WAYBILL_MAINNET_ATTESTOR_REGISTRY_ADDRESS',
  bondVaultAddress: 'VITE_WAYBILL_MAINNET_BOND_VAULT_ADDRESS',
  financingVaultAddress: 'VITE_WAYBILL_MAINNET_FINANCING_VAULT_ADDRESS',
} as const

function required(environment: BrowserEnvironment, name: string): string {
  const value = environment[name]?.trim()
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

function mainnetManifest(environment: BrowserEnvironment): WaybillNetworkManifest {
  const chainIdText = required(environment, MAINNET_VARIABLES.chainId)
  if (!/^\d+$/.test(chainIdText)) {
    throw new Error(`Invalid ${MAINNET_VARIABLES.chainId}: expected an integer`)
  }

  return {
    network: 'mainnet',
    chainId: Number(chainIdText),
    rpcUrl: required(environment, MAINNET_VARIABLES.rpcUrl),
    explorerUrl: required(environment, MAINNET_VARIABLES.explorerUrl),
    usdc: {
      address: required(environment, MAINNET_VARIABLES.usdcAddress) as `0x${string}`,
      decimals: 6,
    },
    nativeGasDecimals: 18,
    contracts: {
      escrow: required(environment, MAINNET_VARIABLES.escrowAddress) as `0x${string}`,
      arbiterList: required(environment, MAINNET_VARIABLES.arbiterListAddress) as `0x${string}`,
      attestorRegistry: required(
        environment,
        MAINNET_VARIABLES.attestorRegistryAddress,
      ) as `0x${string}`,
      bondVault: required(environment, MAINNET_VARIABLES.bondVaultAddress) as `0x${string}`,
      financingVault: required(
        environment,
        MAINNET_VARIABLES.financingVaultAddress,
      ) as `0x${string}`,
    },
  }
}

function viteEnvironment(): BrowserEnvironment {
  return import.meta.env as BrowserEnvironment
}

export function loadBrowserNetwork(
  environment: BrowserEnvironment = viteEnvironment(),
): WaybillNetworkManifest {
  const network = environment.VITE_WAYBILL_NETWORK?.trim() as WaybillNetwork | undefined

  if (network === 'testnet') {
    return resolveWaybillNetwork('testnet', { testnet: ARC_TESTNET })
  }
  if (network === 'mainnet') {
    return resolveWaybillNetwork('mainnet', {
      mainnet: mainnetManifest(environment),
    })
  }
  throw new Error('VITE_WAYBILL_NETWORK must be explicitly set to testnet or mainnet')
}

export function toViemChain(manifest: WaybillNetworkManifest): Chain {
  return defineChain({
    id: manifest.chainId,
    name: manifest.network === 'testnet' ? 'Arc Testnet' : 'Arc',
    nativeCurrency: {
      name: 'USDC',
      symbol: 'USDC',
      decimals: manifest.nativeGasDecimals,
    },
    rpcUrls: {
      default: { http: [manifest.rpcUrl] },
    },
    blockExplorers: {
      default: {
        name: manifest.network === 'testnet' ? 'Arc Testnet Explorer' : 'Arc Explorer',
        url: manifest.explorerUrl,
      },
    },
  })
}

export function getBrowserNetwork(): WaybillNetworkManifest {
  return loadBrowserNetwork()
}

export function getBrowserChain(): Chain {
  return toViemChain(loadBrowserNetwork())
}
