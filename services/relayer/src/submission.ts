import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  parseAbi,
  type TransactionReceipt,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

import type { WaybillNetworkManifest } from '../../../config/networks'
import type { RelayerPrivateKey } from './config'
import type { RelayerCandidate } from './chain'
import type { EligibilityResult } from './eligibility'

export const RELAYER_WRITE_ABI = parseAbi([
  'function claim(uint256 dealId, uint8 milestoneIndex)',
  'function refund(uint256 dealId, uint8 milestoneIndex)',
  'function applyDefault(uint256 dealId, uint8 milestoneIndex)',
])

type RelayerFunctionName = 'claim' | 'refund' | 'applyDefault'
type TransactionHash = `0x${string}`

export interface RelayerWriteClient {
  readonly escrow: `0x${string}`
  writeContract(parameters: {
    abi: typeof RELAYER_WRITE_ABI
    functionName: RelayerFunctionName
    args: readonly [bigint, number]
  }): Promise<TransactionHash>
  waitForTransactionReceipt(parameters: {
    hash: TransactionHash
    confirmations: 1
  }): Promise<Pick<TransactionReceipt, 'status' | 'transactionHash'>>
}

export interface SubmissionResult {
  hash: TransactionHash
  status: 'success' | 'reverted'
}

function chainFor(manifest: WaybillNetworkManifest) {
  return defineChain({
    id: manifest.chainId,
    name: manifest.network === 'testnet' ? 'Arc Testnet' : 'Arc',
    nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
    rpcUrls: { default: { http: [manifest.rpcUrl] } },
  })
}

export function createRelayerSubmissionClient(
  manifest: WaybillNetworkManifest,
  privateKey: RelayerPrivateKey,
): RelayerWriteClient {
  const account = privateKeyToAccount(privateKey)
  const chain = chainFor(manifest)
  const wallet = createWalletClient({
    account,
    chain,
    transport: http(manifest.rpcUrl),
  })
  const publicClient = createPublicClient({
    chain,
    transport: http(manifest.rpcUrl),
  })

  return {
    escrow: manifest.contracts.escrow,
    writeContract: (parameters) =>
      wallet.writeContract({
        ...parameters,
        address: manifest.contracts.escrow,
        account,
        chain,
      } as never),
    waitForTransactionReceipt: (parameters) =>
      publicClient.waitForTransactionReceipt(parameters) as Promise<
        Pick<TransactionReceipt, 'status' | 'transactionHash'>
      >,
  }
}

export async function submitEligibleCandidate(
  client: RelayerWriteClient,
  candidate: RelayerCandidate,
  eligibility: EligibilityResult,
): Promise<SubmissionResult> {
  if (eligibility.eligible === false) {
    throw new Error(`Refusing ineligible relayer candidate: ${eligibility.reason}`)
  }

  const functionName: RelayerFunctionName =
    candidate.operation === 'claim' ||
    candidate.operation === 'refund' ||
    candidate.operation === 'applyDefault'
      ? candidate.operation
      : (() => {
          throw new Error('Unknown relayer operation')
        })()

  const hash = await client.writeContract({
    abi: RELAYER_WRITE_ABI,
    functionName,
    args: [candidate.dealId, candidate.milestoneIndex],
  })
  const receipt = await client.waitForTransactionReceipt({ hash, confirmations: 1 })
  return { hash, status: receipt.status }
}
