export const WAYBILL_NETWORKS = ['testnet', 'mainnet'] as const
export type WaybillNetwork = (typeof WAYBILL_NETWORKS)[number]

export type Address = `0x${string}`

export interface WaybillContracts {
  escrow: Address
  arbiterList: Address
  attestorRegistry: Address
  bondVault: Address
  financingVault: Address
}

export interface WaybillNetworkManifest {
  network: WaybillNetwork
  chainId: number
  rpcUrl: string
  explorerUrl: string
  usdc: {
    address: Address
    decimals: 6
  }
  nativeGasDecimals: 18
  contracts: WaybillContracts
}

export const ARC_TESTNET: WaybillNetworkManifest = {
  network: 'testnet',
  chainId: 5_042_002,
  rpcUrl: 'https://rpc.testnet.arc.io',
  explorerUrl: 'https://explorer.testnet.arc.io',
  usdc: {
    address: '0x3600000000000000000000000000000000000000',
    decimals: 6,
  },
  nativeGasDecimals: 18,
  contracts: {
    escrow: '0xcf08585EdCEb9b8612046b2205cf1aa2C42E5EfA',
    arbiterList: '0xcA46c6A2665F2A5F9b021ad256D00002144d7492',
    attestorRegistry: '0x5D68F4f934F49c39Ce1Be134254FAbd1AECcB225',
    bondVault: '0x977cCa77f36D84949cc959635Da41c85ce470b43',
    financingVault: '0x375Eed4d2E0030E33c491F8570693ebC03ff84f5',
  },
}

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/

function assertAddress(value: string, field: string): asserts value is Address {
  if (!ADDRESS_PATTERN.test(value)) {
    throw new Error(`Invalid address for ${field}`)
  }
}

function assertManifest(manifest: WaybillNetworkManifest): WaybillNetworkManifest {
  if (!WAYBILL_NETWORKS.includes(manifest.network)) {
    throw new Error(`Unsupported Waybill network: ${manifest.network}`)
  }
  if (!Number.isInteger(manifest.chainId) || manifest.chainId <= 0) {
    throw new Error(`Invalid chain id for ${manifest.network}`)
  }
  for (const [field, value] of [
    ['rpcUrl', manifest.rpcUrl],
    ['explorerUrl', manifest.explorerUrl],
  ] as const) {
    try {
      const url = new URL(value)
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error()
    } catch {
      throw new Error(`Invalid ${field} for ${manifest.network}`)
    }
  }
  if (manifest.usdc.decimals !== 6) {
    throw new Error(`USDC must use 6 decimals for ${manifest.network}`)
  }
  if (manifest.nativeGasDecimals !== 18) {
    throw new Error(`Native gas must use 18 decimals for ${manifest.network}`)
  }

  assertAddress(manifest.usdc.address, `${manifest.network}.usdc.address`)
  for (const [name, address] of Object.entries(manifest.contracts)) {
    assertAddress(address, `${manifest.network}.contracts.${name}`)
  }
  return manifest
}

export function resolveWaybillNetwork(
  network: WaybillNetwork,
  manifests: Partial<Record<WaybillNetwork, WaybillNetworkManifest>>,
): WaybillNetworkManifest {
  const manifest = manifests[network]
  if (!manifest) {
    throw new Error(
      `No complete deployment manifest configured for ${network}; refusing to fall back to another network`,
    )
  }
  return assertManifest(manifest)
}

export const TESTNET_NETWORKS: Partial<Record<WaybillNetwork, WaybillNetworkManifest>> = {
  testnet: ARC_TESTNET,
}
