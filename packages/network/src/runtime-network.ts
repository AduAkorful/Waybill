import {
  ARC_MAINNET,
  ARC_TESTNET,
  resolveMainnet,
  type WaybillNetwork,
  type WaybillNetworkManifest,
  resolveWaybillNetwork,
} from './networks'

export interface RuntimeEnvironment {
  [key: string]: string | undefined
}

const MAINNET_VARIABLES = {
  chainId: 'WAYBILL_MAINNET_CHAIN_ID',
  rpcUrl: 'WAYBILL_MAINNET_RPC_URL',
  explorerUrl: 'WAYBILL_MAINNET_EXPLORER_URL',
  usdcAddress: 'WAYBILL_MAINNET_USDC_ADDRESS',
  escrowAddress: 'WAYBILL_MAINNET_ESCROW_ADDRESS',
  arbiterListAddress: 'WAYBILL_MAINNET_ARBITER_LIST_ADDRESS',
  attestorRegistryAddress: 'WAYBILL_MAINNET_ATTESTOR_REGISTRY_ADDRESS',
  bondVaultAddress: 'WAYBILL_MAINNET_BOND_VAULT_ADDRESS',
  financingVaultAddress: 'WAYBILL_MAINNET_FINANCING_VAULT_ADDRESS',
} as const

const LOCAL_FORK = 'WAYBILL_LOCAL_FORK'

/** The local fork's relayer must read a chain on this machine, never a remote one. */
function isLocalRpc(url: string): boolean {
  try {
    const host = new URL(url).hostname
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.localhost')
  } catch {
    return false
  }
}

function mainnetManifest(environment: RuntimeEnvironment, checkedIn: WaybillNetworkManifest | undefined): WaybillNetworkManifest {
  const value = (name: string) => environment[name]?.trim() || undefined
  const localFork = value(LOCAL_FORK) === '1'
  const rpcUrl = value(MAINNET_VARIABLES.rpcUrl)
  if (localFork && !checkedIn && (!rpcUrl || !isLocalRpc(rpcUrl))) {
    throw new Error(`${LOCAL_FORK}=1 needs ${MAINNET_VARIABLES.rpcUrl} on localhost`)
  }
  return resolveMainnet({
    checkedIn,
    localFork,
    environment: {
      chainId: value(MAINNET_VARIABLES.chainId),
      rpcUrl,
      explorerUrl: value(MAINNET_VARIABLES.explorerUrl),
      usdc: value(MAINNET_VARIABLES.usdcAddress),
      escrow: value(MAINNET_VARIABLES.escrowAddress),
      arbiterList: value(MAINNET_VARIABLES.arbiterListAddress),
      attestorRegistry: value(MAINNET_VARIABLES.attestorRegistryAddress),
      bondVault: value(MAINNET_VARIABLES.bondVaultAddress),
      financingVault: value(MAINNET_VARIABLES.financingVaultAddress),
    },
  })
}

/** `checkedInMainnet` is ARC_MAINNET; tests pass their own. */
export function loadRuntimeNetwork(
  environment: RuntimeEnvironment,
  checkedInMainnet: WaybillNetworkManifest | undefined = ARC_MAINNET,
): WaybillNetworkManifest {
  const network = environment.WAYBILL_NETWORK?.trim() as WaybillNetwork | undefined
  if (network === 'testnet') {
    return resolveWaybillNetwork('testnet', { testnet: ARC_TESTNET })
  }
  if (network === 'mainnet') {
    return mainnetManifest(environment, checkedInMainnet)
  }
  throw new Error('WAYBILL_NETWORK must be explicitly set to testnet or mainnet')
}
