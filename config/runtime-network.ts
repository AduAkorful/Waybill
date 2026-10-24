import {
  ARC_TESTNET,
  type Address,
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

function required(environment: RuntimeEnvironment, name: string): string {
  const value = environment[name]?.trim()
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

function requiredAddress(environment: RuntimeEnvironment, name: string): Address {
  return required(environment, name) as Address
}

function mainnetManifest(environment: RuntimeEnvironment): WaybillNetworkManifest {
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
      address: requiredAddress(environment, MAINNET_VARIABLES.usdcAddress),
      decimals: 6,
    },
    nativeGasDecimals: 18,
    contracts: {
      escrow: requiredAddress(environment, MAINNET_VARIABLES.escrowAddress),
      arbiterList: requiredAddress(environment, MAINNET_VARIABLES.arbiterListAddress),
      attestorRegistry: requiredAddress(environment, MAINNET_VARIABLES.attestorRegistryAddress),
      bondVault: requiredAddress(environment, MAINNET_VARIABLES.bondVaultAddress),
      financingVault: requiredAddress(environment, MAINNET_VARIABLES.financingVaultAddress),
    },
  }
}

export function loadRuntimeNetwork(environment: RuntimeEnvironment): WaybillNetworkManifest {
  const network = environment.WAYBILL_NETWORK?.trim() as WaybillNetwork | undefined
  if (network === 'testnet') {
    return resolveWaybillNetwork('testnet', { testnet: ARC_TESTNET })
  }
  if (network === 'mainnet') {
    return resolveWaybillNetwork('mainnet', { mainnet: mainnetManifest(environment) })
  }
  throw new Error('WAYBILL_NETWORK must be explicitly set to testnet or mainnet')
}
