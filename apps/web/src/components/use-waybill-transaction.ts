'use client'

import { useCallback, useState } from 'react'
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

export function useWaybillTransaction() {
  const { chainId } = useAccount()
  const { data: walletClient } = useWalletClient()
  const publicClient = usePublicClient()
  const [state, setState] = useState<ComponentTransactionState>({ status: 'idle' })

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
      setState({ status: 'confirming', hash })
      const result = await waitForActionReceipt(publicClient, hash)
      if (result.status === 'unknown') {
        setState(result)
      } else {
        setState({ ...result, receipt: result.receipt })
      }
    } catch (error) {
      setState({ status: 'error', error: classifyWalletError(error) })
    }
  }, [chainId, publicClient, walletClient])

  const reset = useCallback(() => setState({ status: 'idle' }), [])

  return { execute, reset, state, ready: Boolean(walletClient && publicClient && chainId) }
}
