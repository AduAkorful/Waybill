import { defineChain, type Chain } from 'viem'
import {
  ARC_MAINNET,
  ARC_TESTNET,
  resolveMainnet,
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

/** Local fork: Multicall3 on the fork. Real mainnet: optional, must repeat the checked-in value. */
const MAINNET_MULTICALL3 = 'NEXT_PUBLIC_WAYBILL_MAINNET_MULTICALL3_ADDRESS'
/** Local fork: "1" when the fork escrow has the decide-after-response rule. Real mainnet: optional, must match the checked-in value. */
const MAINNET_EARLY_RESOLVE = 'NEXT_PUBLIC_WAYBILL_MAINNET_EARLY_RESOLVE'

/** "1" only on the local anvil fork stack, where the environment supplies the whole mainnet manifest. */
const LOCAL_FORK = 'NEXT_PUBLIC_WAYBILL_LOCAL_FORK'

function mainnetManifest(environment: BrowserEnvironment, checkedIn: WaybillNetworkManifest | undefined): WaybillNetworkManifest {
  const value = (name: string) => environment[name]?.trim() || undefined
  const early = value(MAINNET_EARLY_RESOLVE)
  return resolveMainnet({
    checkedIn,
    localFork: value(LOCAL_FORK) === '1',
    resolveRpcUrl: (url) => resolveSameOrigin(url, MAINNET_VARIABLES.rpcUrl),
    environment: {
      chainId: value(MAINNET_VARIABLES.chainId),
      rpcUrl: value(MAINNET_VARIABLES.rpcUrl),
      explorerUrl: value(MAINNET_VARIABLES.explorerUrl),
      usdc: value(MAINNET_VARIABLES.usdcAddress),
      escrow: value(MAINNET_VARIABLES.escrowAddress),
      arbiterList: value(MAINNET_VARIABLES.arbiterListAddress),
      attestorRegistry: value(MAINNET_VARIABLES.attestorRegistryAddress),
      bondVault: value(MAINNET_VARIABLES.bondVaultAddress),
      financingVault: value(MAINNET_VARIABLES.financingVaultAddress),
      multicall3: value(MAINNET_MULTICALL3),
      ...(early === '1' ? { earlyResolve: true } : early === '0' ? { earlyResolve: false } : {}),
    },
  })
}

/** `checkedInMainnet` is ARC_MAINNET; tests pass their own, or null for none (undefined would select the default). */
export function loadBrowserNetwork(
  environment: BrowserEnvironment = publicEnvironment(),
  checkedInMainnet: WaybillNetworkManifest | null = ARC_MAINNET ?? null,
): WaybillNetworkManifest {
  const network = environment.NEXT_PUBLIC_WAYBILL_NETWORK?.trim() as WaybillNetwork | undefined

  if (network === 'testnet') {
    return resolveWaybillNetwork('testnet', { testnet: ARC_TESTNET })
  }
  if (network === 'mainnet') {
    return mainnetManifest(environment, checkedInMainnet ?? undefined)
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
