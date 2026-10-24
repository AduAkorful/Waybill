import {
  encodeFunctionData,
  type Abi,
  type PublicClient,
} from 'viem'
import type { Address, WaybillNetworkManifest } from '@waybill/network/networks'
import { getBrowserNetwork } from './network'
import type { EncodedWalletAction } from './escrow'

export const VAULTS_REGISTRY_ABI: Abi = [
  ...([
    ['deposit', [{ name: 'amount', type: 'uint256' }]],
    ['withdraw', [{ name: 'amount', type: 'uint256' }]],
  ].map(([name, inputs]) => ({
    type: 'function',
    name,
    stateMutability: 'nonpayable',
    inputs,
    outputs: [],
  })) as unknown as Abi[number][]),
  {
    type: 'function',
    name: 'flagNegligent',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'dealId', type: 'uint256' },
      { name: 'milestoneIndex', type: 'uint8' },
      { name: 'attestor', type: 'address' },
      { name: 'slashBps', type: 'uint16' },
      { name: 'harmed', type: 'address' },
    ],
    outputs: [{ name: 'slashId', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'reverseFlag',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'slashId', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'executeSlash',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'slashId', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'borrow',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'dealId', type: 'uint256' },
      { name: 'amount', type: 'uint256' },
      { name: 'interestBps', type: 'uint16' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'repay',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'dealId', type: 'uint256' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'setProfile',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'city', type: 'string' },
      { name: 'agentId', type: 'uint64' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as unknown as Abi

const USDC_APPROVE_ABI: Abi = [{
  type: 'function',
  name: 'approve',
  stateMutability: 'nonpayable',
  inputs: [
    { name: 'spender', type: 'address' },
    { name: 'amount', type: 'uint256' },
  ],
  outputs: [{ name: '', type: 'bool' }],
}]

const FINANCING_READ_ABI: Abi = [
  {
    type: 'function',
    name: 'freeLiquidity',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'lenderBalance',
    stateMutability: 'view',
    inputs: [{ name: 'lender', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'lenderPrincipal',
    stateMutability: 'view',
    inputs: [{ name: 'lender', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'getLoan',
    stateMutability: 'view',
    inputs: [{ name: 'dealId', type: 'uint256' }],
    outputs: [
      { name: 'supplier', type: 'address' },
      { name: 'principal', type: 'uint256' },
      { name: 'interestBps', type: 'uint16' },
      { name: 'remaining', type: 'uint256' },
    ],
  },
]

const BOND_READ_ABI: Abi = [
  {
    type: 'function',
    name: 'freeBond',
    stateMutability: 'view',
    inputs: [{ name: 'attestor', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'nextSlashId',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'getSlash',
    stateMutability: 'view',
    inputs: [{ name: 'slashId', type: 'uint256' }],
    outputs: [{
      name: 'slash',
      type: 'tuple',
      components: [
        { name: 'dealId', type: 'uint256' },
        { name: 'milestoneIndex', type: 'uint8' },
        { name: 'attestor', type: 'address' },
        { name: 'harmed', type: 'address' },
        { name: 'amount', type: 'uint256' },
        { name: 'eta', type: 'uint64' },
        { name: 'reversed', type: 'bool' },
        { name: 'executed', type: 'bool' },
      ],
    }],
  },
]

const REGISTRY_READ_ABI: Abi = [
  {
    type: 'function',
    name: 'status',
    stateMutability: 'view',
    inputs: [{ name: 'attestor', type: 'address' }],
    outputs: [{ name: '', type: 'uint8' }],
  },
  {
    type: 'function',
    name: 'counts',
    stateMutability: 'view',
    inputs: [{ name: 'attestor', type: 'address' }],
    outputs: [
      { name: 'attested', type: 'uint32' },
      { name: 'upheld', type: 'uint32' },
      { name: 'slashed', type: 'uint32' },
    ],
  },
  {
    type: 'function',
    name: 'getProfile',
    stateMutability: 'view',
    inputs: [{ name: 'attestor', type: 'address' }],
    outputs: [
      { name: 'name', type: 'string' },
      { name: 'city', type: 'string' },
      { name: 'agentId', type: 'uint64' },
    ],
  },
]

const ARBITER_LIST_READ_ABI: Abi = [
  {
    type: 'function',
    name: 'isAllowed',
    stateMutability: 'view',
    inputs: [{ name: 'arbiter', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'feeUsdc',
    stateMutability: 'view',
    inputs: [{ name: 'arbiter', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
]

export type VaultRegistryAction =
  | { kind: 'approveBond' | 'approveFinancing'; amount: bigint }
  | { kind: 'depositBond' | 'withdrawBond' | 'depositFinancing' | 'withdrawFinancing'; amount: bigint }
  | { kind: 'flagNegligent'; dealId: bigint; milestoneIndex: number; attestor: Address; slashBps: number; harmed: Address }
  | { kind: 'reverseFlag' | 'executeSlash'; slashId: bigint }
  | { kind: 'borrow'; dealId: bigint; amount: bigint; interestBps: number }
  | { kind: 'repay'; dealId: bigint; amount: bigint }
  | { kind: 'setAttestorProfile'; name: string; city: string; agentId: bigint }

function assertUint(value: bigint | number, max: bigint, field: string): void {
  const numeric = typeof value === 'number' ? BigInt(value) : value
  if (numeric < 0n || numeric > max) throw new Error(`${field} is outside its uint range`)
}

function assertAddress(value: string, field: string): asserts value is Address {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) throw new Error(`Invalid ${field}`)
}

function assertAmount(amount: bigint): void {
  assertUint(amount, 2n ** 256n - 1n, 'amount')
  if (amount === 0n) throw new Error('amount must be greater than zero')
}

function encode(
  abi: Abi,
  functionName: string,
  args: readonly unknown[],
  to: Address,
  network: WaybillNetworkManifest,
): EncodedWalletAction {
  return {
    to,
    data: encodeFunctionData({ abi, functionName: functionName as never, args: args as never }),
    chainId: network.chainId,
  }
}

function usdcApproval(
  amount: bigint,
  spender: Address,
  network: WaybillNetworkManifest,
): EncodedWalletAction {
  if (amount < 0n) throw new Error('approval amount cannot be negative')
  return encode(USDC_APPROVE_ABI, 'approve', [spender, amount], network.usdc.address, network)
}

export function encodeVaultRegistryAction(
  action: VaultRegistryAction,
  network: WaybillNetworkManifest = getBrowserNetwork(),
): EncodedWalletAction {
  const financing = network.contracts.financingVault
  const bond = network.contracts.bondVault
  const registry = network.contracts.attestorRegistry

  switch (action.kind) {
    case 'approveBond':
      return usdcApproval(action.amount, bond, network)
    case 'approveFinancing':
      return usdcApproval(action.amount, financing, network)
    case 'depositBond':
    case 'withdrawBond':
      assertAmount(action.amount)
      return encode(VAULTS_REGISTRY_ABI, action.kind.replace('Bond', ''), [action.amount], bond, network)
    case 'depositFinancing':
    case 'withdrawFinancing':
      assertAmount(action.amount)
      return encode(VAULTS_REGISTRY_ABI, action.kind.replace('Financing', ''), [action.amount], financing, network)
    case 'flagNegligent':
      assertUint(action.dealId, 2n ** 256n - 1n, 'dealId')
      assertUint(action.milestoneIndex, 255n, 'milestoneIndex')
      assertUint(action.slashBps, 10_000n, 'slashBps')
      if (action.slashBps === 0) throw new Error('slashBps must be greater than zero')
      assertAddress(action.attestor, 'attestor')
      assertAddress(action.harmed, 'harmed')
      return encode(VAULTS_REGISTRY_ABI, 'flagNegligent', [
        action.dealId,
        action.milestoneIndex,
        action.attestor,
        action.slashBps,
        action.harmed,
      ], bond, network)
    case 'reverseFlag':
    case 'executeSlash':
      assertUint(action.slashId, 2n ** 256n - 1n, 'slashId')
      return encode(VAULTS_REGISTRY_ABI, action.kind, [action.slashId], bond, network)
    case 'borrow':
      assertUint(action.dealId, 2n ** 256n - 1n, 'dealId')
      assertAmount(action.amount)
      assertUint(action.interestBps, 2_000n, 'interestBps')
      return encode(VAULTS_REGISTRY_ABI, 'borrow', [
        action.dealId,
        action.amount,
        action.interestBps,
      ], financing, network)
    case 'repay':
      assertUint(action.dealId, 2n ** 256n - 1n, 'dealId')
      assertAmount(action.amount)
      return encode(VAULTS_REGISTRY_ABI, 'repay', [action.dealId, action.amount], financing, network)
    case 'setAttestorProfile':
      if (!action.name.trim() || !action.city.trim()) throw new Error('Profile name and city are required')
      if (action.name.length > 256 || action.city.length > 256) throw new Error('Profile field is too long')
      assertUint(action.agentId, 2n ** 64n - 1n, 'agentId')
      return encode(VAULTS_REGISTRY_ABI, 'setProfile', [
        action.name,
        action.city,
        action.agentId,
      ], registry, network)
    default:
      throw new Error('Unsupported vault or registry action')
  }
}

export function readFinancingLiquidity(
  client: PublicClient,
  network: WaybillNetworkManifest = getBrowserNetwork(),
) {
  return client.readContract({
    address: network.contracts.financingVault,
    abi: FINANCING_READ_ABI,
    functionName: 'freeLiquidity',
  })
}

export function readFinancingLender(
  client: PublicClient,
  lender: Address,
  network: WaybillNetworkManifest = getBrowserNetwork(),
) {
  assertAddress(lender, 'lender')
  return client.readContract({
    address: network.contracts.financingVault,
    abi: FINANCING_READ_ABI,
    functionName: 'lenderBalance',
    args: [lender],
  })
}

export function readBondBalance(
  client: PublicClient,
  attestor: Address,
  network: WaybillNetworkManifest = getBrowserNetwork(),
) {
  assertAddress(attestor, 'attestor')
  return client.readContract({
    address: network.contracts.bondVault,
    abi: BOND_READ_ABI,
    functionName: 'freeBond',
    args: [attestor],
  })
}

export function readAttestorProfile(
  client: PublicClient,
  attestor: Address,
  network: WaybillNetworkManifest = getBrowserNetwork(),
) {
  assertAddress(attestor, 'attestor')
  return client.readContract({
    address: network.contracts.attestorRegistry,
    abi: REGISTRY_READ_ABI,
    functionName: 'getProfile',
    args: [attestor],
  })
}

export function readArbiterEligibility(
  client: PublicClient,
  arbiter: Address,
  network: WaybillNetworkManifest = getBrowserNetwork(),
) {
  assertAddress(arbiter, 'arbiter')
  return Promise.all([
    client.readContract({
      address: network.contracts.arbiterList,
      abi: ARBITER_LIST_READ_ABI,
      functionName: 'isAllowed',
      args: [arbiter],
    }),
    client.readContract({
      address: network.contracts.arbiterList,
      abi: ARBITER_LIST_READ_ABI,
      functionName: 'feeUsdc',
      args: [arbiter],
    }),
  ] as const)
}
