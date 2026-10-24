'use client'

import { useCallback, useRef, useState } from 'react'
import { useAccount, usePublicClient, useWalletClient } from 'wagmi'
import type { Hex } from 'viem'
import type { EncodedWalletAction } from '../integration/escrow'
import {
  assertActionNetwork,
  assertCanPayFee,
  classifyWalletError,
  waitForActionReceipt,
  type WaybillWalletError,
} from '../integration/transactions'
import { sendWalletAction } from '../integration/escrow'

export type ComponentTransactionState =
  | { status: 'idle' }
  | { status: 'signing' }
  | { status: 'confirming'; hash: Hex }
  | { status: 'success' | 'reverted'; hash: Hex; receipt: unknown }
  | { status: 'unknown'; hash: Hex; error: unknown }
  | { status: 'error'; error: WaybillWalletError }

/**
 * A sent transaction is remembered for this tab until its outcome is known. A real wallet can make the page re-render
 * the dialog from scratch while it is open (sign-in state settling, the wallet reconnecting); without this the dialog
 * came back on its idle button and the confirmation was never seen.
 */
const pendingKey = (from: string, action: EncodedWalletAction) =>
  `wb-tx:${action.chainId}:${from.toLowerCase()}:${action.to.toLowerCase()}:${action.data}`
/** After this long a hash that never confirmed is dropped, so the same action can be offered again. */
const PENDING_MAX_MS = 30 * 60_000
function rememberPending(from: string | undefined, action: EncodedWalletAction, hash: Hex | null): void {
  if (!from) return
  try {
    if (hash) window.sessionStorage.setItem(pendingKey(from, action), JSON.stringify({ hash, at: Date.now() }))
    else window.sessionStorage.removeItem(pendingKey(from, action))
  } catch {
    // storage blocked: the flow still works, it just cannot pick up again after a remount
  }
}
function pendingHash(from: string | undefined, action: EncodedWalletAction): Hex | null {
  if (!from) return null
  try {
    const key = pendingKey(from, action)
    const v = JSON.parse(window.sessionStorage.getItem(key) ?? 'null') as { hash?: unknown; at?: unknown } | null
    if (!v || typeof v.hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(v.hash) || typeof v.at !== 'number') return null
    if (Date.now() - v.at > PENDING_MAX_MS) {
      window.sessionStorage.removeItem(key)
      return null
    }
    return v.hash as Hex
  } catch {
    return null
  }
}

export function useWaybillTransaction() {
  const { chainId, address } = useAccount()
  const { data: walletClient } = useWalletClient()
  const publicClient = usePublicClient()
  const [state, setState] = useState<ComponentTransactionState>({ status: 'idle' })
  const resumed = useRef<string | null>(null)

  const settle = useCallback(async (action: EncodedWalletAction, hash: Hex, from: string | undefined) => {
    if (!publicClient) return
    setState({ status: 'confirming', hash })
    const result = await waitForActionReceipt(publicClient, hash)
    if (result.status === 'unknown') {
      setState(result)
    } else {
      rememberPending(from, action, null)
      setState({ ...result, receipt: result.receipt })
    }
  }, [publicClient])

  /** Pick up a transaction this tab already sent for the same action, instead of offering to send it again. */
  const resume = useCallback((action: EncodedWalletAction) => {
    const hash = pendingHash(address, action)
    if (!hash || !publicClient || resumed.current === hash) return
    resumed.current = hash
    void settle(action, hash, address)
  }, [publicClient, settle, address])

  const execute = useCallback(async (action: EncodedWalletAction) => {
    if (!walletClient) {
      setState({
        status: 'error',
        error: classifyWalletError(new Error('No active wallet account')),
      })
      return
    }
    if (!publicClient || chainId === undefined) {
      setState({
        status: 'error',
        error: classifyWalletError(new Error('Wallet or chain is not ready')),
      })
      return
    }

    try {
      assertActionNetwork(action, chainId)
      // Ask the chain first: if the contract would refuse right now, say why and never open the wallet.
      if (walletClient.account) {
        await publicClient.call({
          account: walletClient.account,
          to: action.to,
          data: action.data,
        })
        // Gas is paid in USDC on Arc: a wallet that cannot cover the fee is told so here, not left to a greyed-out wallet popup.
        const [balance, gas, gasPrice] = await Promise.all([
          publicClient.getBalance({ address: walletClient.account.address }),
          publicClient.estimateGas({ account: walletClient.account, to: action.to, data: action.data }),
          publicClient.getGasPrice(),
        ])
        assertCanPayFee(balance, gas, gasPrice)
      }
      setState({ status: 'signing' })
      const hash = await sendWalletAction(walletClient, action)
      const from = walletClient.account.address
      rememberPending(from, action, hash)
      resumed.current = hash
      await settle(action, hash, from)
    } catch (error) {
      setState({ status: 'error', error: classifyWalletError(error) })
    }
  }, [chainId, publicClient, walletClient, settle])

  const reset = useCallback(() => setState({ status: 'idle' }), [])

  return { execute, resume, reset, state, ready: Boolean(walletClient && publicClient && chainId) }
}
