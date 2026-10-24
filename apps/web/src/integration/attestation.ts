import {
  encodeFunctionData,
  hashTypedData,
  keccak256,
  toBytes,
  type Hex,
  type PublicClient,
  type WalletClient,
} from 'viem'
import type { Address, WaybillNetworkManifest } from '@waybill/network/networks'
import { getBrowserNetwork } from './network'
import type { EncodedWalletAction } from './escrow'

export const WAYBILL_STATEMENT_VERSION = keccak256(toBytes('waybill.v1'))

export const WAYBILL_ATTESTATION_TYPES = {
  Attestation: [
    { name: 'dealId', type: 'uint256' },
    { name: 'milestoneIndex', type: 'uint8' },
    { name: 'chainId', type: 'uint256' },
    { name: 'verifyingContract', type: 'address' },
    { name: 'signer', type: 'address' },
    { name: 'statementVersion', type: 'bytes32' },
    { name: 'evidenceHash', type: 'bytes32' },
    { name: 'signedAt', type: 'uint64' },
    { name: 'expiry', type: 'uint64' },
  ],
} as const

export interface AttestationInput {
  dealId: bigint
  milestoneIndex: number
  evidenceHash: Hex
  signedAt: bigint
  expiry: bigint
  signer: Address
}

export interface WaybillAttestationTypedData {
  domain: {
    name: 'WaybillEscrow'
    version: '1'
    chainId: number
    verifyingContract: Address
  }
  types: typeof WAYBILL_ATTESTATION_TYPES
  primaryType: 'Attestation'
  message: {
    dealId: bigint
    milestoneIndex: number
    chainId: number
    verifyingContract: Address
    signer: Address
    statementVersion: Hex
    evidenceHash: Hex
    signedAt: bigint
    expiry: bigint
  }
}

const ATTEST_ABI = [{
  type: 'function',
  name: 'attest',
  stateMutability: 'nonpayable',
  inputs: [
    { name: 'dealId', type: 'uint256' },
    { name: 'milestoneIndex', type: 'uint8' },
    { name: 'evidenceHash', type: 'bytes32' },
    { name: 'signedAt', type: 'uint64' },
    { name: 'expiry', type: 'uint64' },
    { name: 'signer', type: 'address' },
    { name: 'signature', type: 'bytes' },
  ],
  outputs: [],
}] as const

const USED_ATTESTATION_ABI = [{
  type: 'function',
  name: 'usedAttestations',
  stateMutability: 'view',
  inputs: [{ name: 'digest', type: 'bytes32' }],
  outputs: [{ name: '', type: 'bool' }],
}] as const

function assertUint(value: bigint | number, max: bigint, field: string): void {
  const numeric = typeof value === 'number' ? BigInt(value) : value
  if (numeric < 0n || numeric > max) throw new Error(`${field} is outside its uint range`)
}

function assertAddress(value: string, field: string): asserts value is Address {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) throw new Error(`Invalid ${field}`)
}

function assertHash(value: string, field: string): asserts value is Hex {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error(`Invalid ${field}`)
}

function validateInput(
  input: AttestationInput,
  network: WaybillNetworkManifest,
): void {
  assertUint(input.dealId, 2n ** 256n - 1n, 'dealId')
  assertUint(input.milestoneIndex, 255n, 'milestoneIndex')
  assertHash(input.evidenceHash, 'evidenceHash')
  assertAddress(input.signer, 'signer')
  assertUint(input.signedAt, 2n ** 64n - 1n, 'signedAt')
  assertUint(input.expiry, 2n ** 64n - 1n, 'expiry')
  if (input.expiry <= input.signedAt) throw new Error('expiry must be after signedAt')
  if (!Number.isInteger(network.chainId) || network.chainId <= 0) {
    throw new Error('Invalid network chain id')
  }
}

export function buildAttestationTypedData(
  input: AttestationInput,
  network: WaybillNetworkManifest = getBrowserNetwork(),
): WaybillAttestationTypedData {
  validateInput(input, network)
  return {
    domain: {
      name: 'WaybillEscrow',
      version: '1',
      chainId: network.chainId,
      verifyingContract: network.contracts.escrow,
    },
    types: WAYBILL_ATTESTATION_TYPES,
    primaryType: 'Attestation',
    message: {
      dealId: input.dealId,
      milestoneIndex: input.milestoneIndex,
      chainId: network.chainId,
      verifyingContract: network.contracts.escrow,
      signer: input.signer,
      statementVersion: WAYBILL_STATEMENT_VERSION,
      evidenceHash: input.evidenceHash,
      signedAt: input.signedAt,
      expiry: input.expiry,
    },
  }
}

export function hashAttestation(
  input: AttestationInput,
  network: WaybillNetworkManifest = getBrowserNetwork(),
): Hex {
  return hashTypedData(buildAttestationTypedData(input, network) as never)
}

export async function signAttestation(
  walletClient: WalletClient,
  input: AttestationInput,
  network: WaybillNetworkManifest = getBrowserNetwork(),
): Promise<Hex> {
  const typedData = buildAttestationTypedData(input, network)
  if (walletClient.chain?.id !== network.chainId) {
    throw new Error(`Wallet is on chain ${walletClient.chain?.id ?? 'unknown'}, expected ${network.chainId}`)
  }
  if (!walletClient.account) throw new Error('No active wallet account')
  if (walletClient.account.address.toLowerCase() !== input.signer.toLowerCase()) {
    throw new Error('Active wallet does not match attestation signer')
  }
  return walletClient.signTypedData({
    account: walletClient.account,
    domain: typedData.domain,
    types: typedData.types,
    primaryType: typedData.primaryType,
    message: typedData.message,
  } as never)
}

export function readAttestationUsed(
  client: PublicClient,
  digest: Hex,
  network: WaybillNetworkManifest = getBrowserNetwork(),
) {
  assertHash(digest, 'digest')
  return client.readContract({
    address: network.contracts.escrow,
    abi: USED_ATTESTATION_ABI,
    functionName: 'usedAttestations',
    args: [digest],
  })
}

export function attestAction(
  input: AttestationInput,
  signature: Hex,
  network: WaybillNetworkManifest = getBrowserNetwork(),
): EncodedWalletAction {
  validateInput(input, network)
  if (!/^0x([0-9a-fA-F]{2})+$/.test(signature)) throw new Error('Invalid signature')
  return {
    to: network.contracts.escrow,
    data: encodeFunctionData({
      abi: ATTEST_ABI,
      functionName: 'attest',
      args: [
        input.dealId,
        input.milestoneIndex,
        input.evidenceHash,
        input.signedAt,
        input.expiry,
        input.signer,
        signature,
      ],
    }),
    chainId: network.chainId,
  }
}
