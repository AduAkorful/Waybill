import { defineChain, type Chain } from 'viem'
import {
  ARC_TESTNET,
  resolveWaybillNetwork,
  type WaybillNetwork,
  type WaybillNetworkManifest,
} from '@waybill/network/networks'

import { publicEnvironment } from './env'
import { resolveSameOrigin } from './same-origin'

export type BrowserEnvironment = Record<string, string | undefined>

const MAINNET_VARIABLES = {
  chainId: 'NEXT_PUBLIC_WAYBILL_MAINNET_CHAIN_ID',
  rpcUrl: 'NEXT_PUBLIC_WAYBILL_MAINNET_RPC_URL',
  explorerUrl: 'NEXT_PUBLIC_WAYBILL_MAINNET_EXPLORER_URL',
  usdcAddress: 'NEXT_PUBLIC_WAYBILL_MAINNET_USDC_ADDRESS',
  escrowAddress: 'NEXT_PUBLIC_WAYBILL_MAINNET_ESCROW_ADDRESS',
  arbiterListAddress: 'NEXT_PUBLIC_WAYBILL_MAINNET_ARBITER_LIST_ADDRESS',
  attestorRegistryAddress: 'NEXT_PUBLIC_WAYBILL_MAINNET_ATTESTOR_REGISTRY_ADDRESS',
  bondVaultAddress: 'NEXT_PUBLIC_WAYBILL_MAINNET_BOND_VAULT_ADDRESS',
  financingVaultAddress: 'NEXT_PUBLIC_WAYBILL_MAINNET_FINANCING_VAULT_ADDRESS',
} as const

/** Optional: set only after checking Multicall3 on the mainnet chain. */
const MAINNET_MULTICALL3 = 'NEXT_PUBLIC_WAYBILL_MAINNET_MULTICALL3_ADDRESS'
/** Optional: "1" only when the mainnet escrow was deployed with the decide-after-response rule. */
const MAINNET_EARLY_RESOLVE = 'NEXT_PUBLIC_WAYBILL_MAINNET_EARLY_RESOLVE'

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
    rpcUrl: resolveSameOrigin(required(environment, MAINNET_VARIABLES.rpcUrl), MAINNET_VARIABLES.rpcUrl),
    explorerUrl: required(environment, MAINNET_VARIABLES.explorerUrl),
    usdc: {
      address: required(environment, MAINNET_VARIABLES.usdcAddress) as `0x${string}`,
      decimals: 6,
    },
    nativeGasDecimals: 18,
    ...(environment[MAINNET_MULTICALL3]?.trim() ? { multicall3: environment[MAINNET_MULTICALL3]!.trim() as `0x${string}` } : {}),
    ...(environment[MAINNET_EARLY_RESOLVE]?.trim() === '1' ? { earlyResolve: true } : {}),
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

export function loadBrowserNetwork(
  environment: BrowserEnvironment = publicEnvironment(),
): WaybillNetworkManifest {
  const network = environment.NEXT_PUBLIC_WAYBILL_NETWORK?.trim() as WaybillNetwork | undefined

  if (network === 'testnet') {
    return resolveWaybillNetwork('testnet', { testnet: ARC_TESTNET })
  }
  if (network === 'mainnet') {
    return resolveWaybillNetwork('mainnet', {
      mainnet: mainnetManifest(environment),
    })
  }
  throw new Error('NEXT_PUBLIC_WAYBILL_NETWORK must be explicitly set to testnet or mainnet')
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
    ...(manifest.multicall3 ? { contracts: { multicall3: { address: manifest.multicall3 } } } : {}),
    blockExplorers: {
      default: {
        name: manifest.network === 'testnet' ? 'Arc Testnet Explorer' : 'Arc Explorer',
        url: manifest.explorerUrl,
      },
    },
  })
}

/** One manifest and chain per page load, so hooks that depend on them do not re-run on every render. */
let browserNetwork: WaybillNetworkManifest | undefined
let browserChain: Chain | undefined

export function getBrowserNetwork(): WaybillNetworkManifest {
  return (browserNetwork ??= loadBrowserNetwork())
}

export function getBrowserChain(): Chain {
  return (browserChain ??= toViemChain(getBrowserNetwork()))
}

/** Whether this deployment's escrow lets the arbiter decide as soon as the other side responds. */
export function earlyResolve(): boolean {
  return getBrowserNetwork().earlyResolve === true
}

/** The explorer root without a trailing slash, or '' when this network has no explorer (empty, or a local fork's /no-explorer placeholder). */
export function explorerBase(): string {
  const url = getBrowserNetwork().explorerUrl.trim().replace(/\/+$/, '')
  if (url === '' || /\/no-explorer$/.test(url)) return ''
  return url
}
