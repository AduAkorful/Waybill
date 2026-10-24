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
  /** Multicall3, when the chain has it, so a screen's reads travel as one request. Verified per network, never assumed. */
  multicall3?: Address
  /** First block at which the escrow has code; event reads start here */
  escrowDeployBlock?: bigint
  /** First block at which the attestor registry has code; its event reads start here */
  attestorRegistryDeployBlock?: bigint
  arbiterListDeployBlock?: bigint
  /**
   * True only when this deployment's escrow lets the arbiter decide as soon as the other side responds (the 2026-10-23
   * rule). Absent or false: decisions open only after the response window, as on the current testnet escrow.
   */
  earlyResolve?: boolean
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
    // Plan 50 deploy, commit 4a60eb9, 2026-10-24 (plans/50-deploy.json). Previous escrow 0xcf08…5EfA is retired:
    // the app no longer reads it; its last open deals are recorded in AGENTS.md.
    escrow: '0x542601ad285c9845cBEd91c18af34fD06993f831',
    arbiterList: '0x9748a603B1E6503DDF2350D17d17ea98fE09c33c',
    attestorRegistry: '0x19Ea53a8B6C8D8Ed776e8004D88BEf4Ff19E6555',
    bondVault: '0x6d2d6652A2b7AaB352E8EB2E24Fc1954c14142d5',
    financingVault: '0xAB278803a95E87bBa82a3C8A26B91f02dFD5461F',
  },
  // Checked on Arc testnet: `cast code` returns the contract and getChainId() returns 5042002.
  multicall3: '0xcA11bde05977b3631167028862bE2a173976CA11',
  // Checked on Arc testnet: `cast code` is empty at block 68854414 and present at 68854415.
  escrowDeployBlock: 68_854_415n,
  // Checked on Arc testnet: `cast code` is empty at block 68854409 and present at 68854410.
  attestorRegistryDeployBlock: 68_854_410n,
  // Checked on Arc testnet: `cast code` is empty at block 68854404 and present at 68854405.
  arbiterListDeployBlock: 68_854_405n,
  // This escrow has the decide-after-response rule with the 24-hour rebuttal (DisputeLogic, 31.7 + 33).
  earlyResolve: true,
}

/**
 * Arc mainnet. Undefined until the mainnet deploy (plans/51-mainnet-launch.md): every value is copied from the deploy
 * record and checked with `cast` before it is committed, with a comment saying how, as for ARC_TESTNET above. While it
 * is undefined, mainnet refuses to start (except a flagged local fork, see resolveMainnet).
 */
export const ARC_MAINNET: WaybillNetworkManifest | undefined = undefined

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
  if (manifest.escrowDeployBlock !== undefined && manifest.escrowDeployBlock < 0n) {
    throw new Error(`Invalid ${manifest.network}.escrowDeployBlock`)
  }
  if (manifest.attestorRegistryDeployBlock !== undefined && manifest.attestorRegistryDeployBlock < 0n) {
    throw new Error(`Invalid ${manifest.network}.attestorRegistryDeployBlock`)
  }
  if (manifest.arbiterListDeployBlock !== undefined && manifest.arbiterListDeployBlock < 0n) {
    throw new Error(`Invalid ${manifest.network}.arbiterListDeployBlock`)
  }
  if (manifest.multicall3 !== undefined) assertAddress(manifest.multicall3, `${manifest.network}.multicall3`)
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

/** Mainnet values a process may also receive from its environment. Each one present is only allowed to repeat the checked-in value. */
export interface MainnetEnvironmentValues {
  chainId?: string
  rpcUrl?: string
  explorerUrl?: string
  usdc?: string
  escrow?: string
  arbiterList?: string
  attestorRegistry?: string
  bondVault?: string
  financingVault?: string
  multicall3?: string
  earlyResolve?: boolean
}

export interface ResolveMainnetOptions {
  /** The manifest committed in this file (ARC_MAINNET); a parameter so tests can pass one */
  checkedIn: WaybillNetworkManifest | undefined
  environment: MainnetEnvironmentValues
  /**
   * True only for the local anvil fork stack. With no checked-in manifest, the environment may then supply the whole
   * mainnet manifest, as before. A real deployment never sets it.
   */
  localFork: boolean
  /** Resolves a same-origin path such as `/rpc` (browser only) */
  resolveRpcUrl?: (value: string) => string
}

/** Fields of a mainnet manifest that a real deployment must carry, beyond what assertManifest checks. */
function assertMainnetComplete(manifest: WaybillNetworkManifest): void {
  const missing = [
    manifest.network === 'mainnet' ? null : 'network',
    manifest.multicall3 ? null : 'multicall3',
    manifest.escrowDeployBlock !== undefined ? null : 'escrowDeployBlock',
    manifest.attestorRegistryDeployBlock !== undefined ? null : 'attestorRegistryDeployBlock',
    manifest.arbiterListDeployBlock !== undefined ? null : 'arbiterListDeployBlock',
    manifest.earlyResolve !== undefined ? null : 'earlyResolve',
  ].filter((field): field is string => field !== null)
  if (missing.length > 0) throw new Error(`The checked-in mainnet manifest is incomplete: ${missing.join(', ')}`)
}

const same = (a: string, b: string, isAddress: boolean) => (isAddress ? a.toLowerCase() === b.toLowerCase() : a === b)

/**
 * The mainnet manifest. With one checked in, it is used as is; the environment may repeat its values but any that
 * differ stop the process, so an address typed into a hosting dashboard can never replace a reviewed one. Only the RPC
 * URL may be replaced (a dedicated RPC with a key, or the browser's same-origin proxy); the relayer checks the chain id
 * it answers before starting. With none checked in, mainnet refuses to start unless this is the flagged local fork.
 */
export function resolveMainnet(options: ResolveMainnetOptions): WaybillNetworkManifest {
  const { checkedIn, environment: env, localFork } = options
  const rpc = (value: string) => (options.resolveRpcUrl ? options.resolveRpcUrl(value) : value)

  if (!checkedIn) {
    if (!localFork) {
      throw new Error(
        'No mainnet manifest is checked in (ARC_MAINNET in packages/network/src/networks.ts); refusing to start on mainnet',
      )
    }
    const required = (value: string | undefined, field: string): string => {
      if (!value?.trim()) throw new Error(`Local fork: missing mainnet ${field}`)
      return value.trim()
    }
    const chainIdText = required(env.chainId, 'chainId')
    if (!/^\d+$/.test(chainIdText)) throw new Error('Local fork: mainnet chainId must be an integer')
    return resolveWaybillNetwork('mainnet', {
      mainnet: {
        network: 'mainnet',
        chainId: Number(chainIdText),
        rpcUrl: rpc(required(env.rpcUrl, 'rpcUrl')),
        explorerUrl: required(env.explorerUrl, 'explorerUrl'),
        usdc: { address: required(env.usdc, 'usdc') as Address, decimals: 6 },
        nativeGasDecimals: 18,
        ...(env.multicall3?.trim() ? { multicall3: env.multicall3.trim() as Address } : {}),
        ...(env.earlyResolve ? { earlyResolve: true } : {}),
        contracts: {
          escrow: required(env.escrow, 'escrow') as Address,
          arbiterList: required(env.arbiterList, 'arbiterList') as Address,
          attestorRegistry: required(env.attestorRegistry, 'attestorRegistry') as Address,
          bondVault: required(env.bondVault, 'bondVault') as Address,
          financingVault: required(env.financingVault, 'financingVault') as Address,
        },
      },
    })
  }

  if (localFork) throw new Error('The local-fork flag is set but a mainnet manifest is checked in; refusing to mix them')
  assertMainnetComplete(checkedIn)
  const checks: [string, string | undefined, string, boolean][] = [
    ['chainId', env.chainId, String(checkedIn.chainId), false],
    ['explorerUrl', env.explorerUrl, checkedIn.explorerUrl, false],
    ['usdc', env.usdc, checkedIn.usdc.address, true],
    ['escrow', env.escrow, checkedIn.contracts.escrow, true],
    ['arbiterList', env.arbiterList, checkedIn.contracts.arbiterList, true],
    ['attestorRegistry', env.attestorRegistry, checkedIn.contracts.attestorRegistry, true],
    ['bondVault', env.bondVault, checkedIn.contracts.bondVault, true],
    ['financingVault', env.financingVault, checkedIn.contracts.financingVault, true],
    ['multicall3', env.multicall3, checkedIn.multicall3 ?? '', true],
  ]
  for (const [field, given, expected, isAddress] of checks) {
    if (given?.trim() && !same(given.trim(), expected, isAddress)) {
      throw new Error(`Mainnet ${field} in the environment (${given.trim()}) does not match the checked-in manifest (${expected})`)
    }
  }
  if (env.earlyResolve !== undefined && env.earlyResolve !== checkedIn.earlyResolve) {
    throw new Error('Mainnet earlyResolve in the environment does not match the checked-in manifest')
  }
  return resolveWaybillNetwork('mainnet', {
    mainnet: { ...checkedIn, ...(env.rpcUrl?.trim() ? { rpcUrl: rpc(env.rpcUrl.trim()) } : {}) },
  })
}
