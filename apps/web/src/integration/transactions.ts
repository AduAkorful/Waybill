import type { Hex, PublicClient, TransactionReceipt } from 'viem'
import type { EncodedWalletAction } from './escrow'
import { getBrowserNetwork } from './network'
import { contractErrorName, contractErrorText, isNetworkBusy, isUserRejection, revertDataOf } from './tx-errors'

export type WalletErrorCode =
  | 'user_rejected'
  | 'wrong_network'
  | 'no_account'
  | 'reverted'
  | 'rpc_error'
  | 'unknown'

export class WaybillWalletError extends Error {
  readonly code: WalletErrorCode
  readonly cause: unknown

  constructor(code: WalletErrorCode, message: string, cause?: unknown) {
    super(message)
    this.name = 'WaybillWalletError'
    this.code = code
    this.cause = cause
  }
}

export type TransactionOutcome =
  | { status: 'success'; hash: Hex; receipt: TransactionReceipt }
  | { status: 'reverted'; hash: Hex; receipt: TransactionReceipt }
  | { status: 'unknown'; hash: Hex; error: unknown }

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message.toLowerCase()
  return String(error).toLowerCase()
}

/**
 * Sorts a failure into what actually happened. A decline is reported only for a real wallet
 * rejection (error code or name), never from wording, so a busy or unreachable network is never
 * called a decline. A revert carries the contract's own error name when the node returned it.
 */
export function classifyWalletError(error: unknown): WaybillWalletError {
  // A limit or outage comes first: some wallets relay an RPC error under a rejection code, and calling that a
  // decline would send people to retry the wrong thing.
  if (isNetworkBusy(error)) {
    return new WaybillWalletError(
      'rpc_error',
      'The network is busy or could not be reached, so we could not check this',
      error,
    )
  }
  if (isUserRejection(error)) {
    return new WaybillWalletError('user_rejected', 'Wallet signature was rejected', error)
  }
  const revertName = contractErrorName(revertDataOf(error))
  if (revertName) {
    return new WaybillWalletError('reverted', contractErrorText(revertName), error)
  }
  const text = errorText(error)
  if (text.includes('wrong network') || text.includes('chain mismatch') || text.includes('expected 5042')) {
    return new WaybillWalletError('wrong_network', 'Wallet is connected to the wrong network', error)
  }
  if (text.includes('no active wallet') || text.includes('not ready')) {
    return new WaybillWalletError('no_account', 'No active wallet account is available', error)
  }
  if (text.includes('execution reverted') || text.includes('revert')) {
    return new WaybillWalletError('reverted', 'The contract would refuse this right now', error)
  }
  return new WaybillWalletError('unknown', 'The wallet request failed', error)
}

export function assertActionNetwork(
  action: EncodedWalletAction,
  chainId: number,
  expectedChainId: number = getBrowserNetwork().chainId,
): void {
  if (action.chainId !== expectedChainId) {
    throw new WaybillWalletError(
      'wrong_network',
      `Action targets unexpected chain ${action.chainId}`,
    )
  }
  if (chainId !== action.chainId) {
    throw new WaybillWalletError(
      'wrong_network',
      `Wallet is on chain ${chainId}, expected ${action.chainId}`,
    )
  }
}

type ReceiptWaiter = Pick<PublicClient, 'waitForTransactionReceipt'>

export async function waitForActionReceipt(
  publicClient: ReceiptWaiter,
  hash: Hex,
): Promise<TransactionOutcome> {
  try {
    const receipt = await publicClient.waitForTransactionReceipt({
      hash,
      confirmations: 1,
    })
    if (receipt.status === 'reverted') {
      return { status: 'reverted', hash, receipt }
    }
    return { status: 'success', hash, receipt }
  } catch (error) {
    return { status: 'unknown', hash, error }
  }
}

/** One plain sentence for any failure of a wallet request, a signature or a call. Raw library text never reaches a person. */
export function plainError(error: unknown): string {
  const classified = classifyWalletError(error)
  switch (classified.code) {
    case 'user_rejected':
      return 'You declined it in your wallet. Nothing was sent. You can try again.'
    case 'rpc_error':
      return 'The network is busy or could not be reached. Nothing was sent; try again in a moment.'
    case 'reverted':
    case 'wrong_network':
    case 'no_account':
      return `${classified.message}. Nothing was sent.`
    default:
      return error instanceof Error && error.message && !/viem@|Version:|Details:/.test(error.message) ? error.message : 'The request failed. Nothing was sent.'
  }
}
