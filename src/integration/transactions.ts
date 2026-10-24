import type { Hex, PublicClient, TransactionReceipt } from 'viem'
import type { EncodedWalletAction } from './escrow'
import { getBrowserNetwork } from './network'

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

export function classifyWalletError(error: unknown): WaybillWalletError {
  const text = errorText(error)
  const code =
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'number'
      ? error.code
      : undefined

  if (code === 4001 || text.includes('user rejected') || text.includes('user denied')) {
    return new WaybillWalletError('user_rejected', 'Wallet signature was rejected', error)
  }
  if (text.includes('wrong network') || text.includes('chain mismatch')) {
    return new WaybillWalletError('wrong_network', 'Wallet is connected to the wrong network', error)
  }
  if (text.includes('no active wallet') || text.includes('account')) {
    return new WaybillWalletError('no_account', 'No active wallet account is available', error)
  }
  if (text.includes('revert') || text.includes('execution reverted')) {
    return new WaybillWalletError('reverted', 'The transaction would revert', error)
  }
  if (text.includes('rpc') || text.includes('network') || text.includes('timeout')) {
    return new WaybillWalletError('rpc_error', 'The chain request failed', error)
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
