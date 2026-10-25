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

  // the hash this flow is settling, so a hash found on chain and the wallet's own late answer settle only once
  const settling = useRef<string | null>(null)
  const settle = useCallback(async (action: EncodedWalletAction, hash: Hex, from: string | undefined) => {
    if (!publicClient) return
    if (settling.current === hash) return
    settling.current = hash
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
      const from = walletClient.account.address
      // Some wallets (seen with Rabby) close their window but answer the page late. Watch the chain meanwhile: once
      // this exact call from this account lands in a block, move on to confirming with its hash.
      const watch = watchForSent(publicClient, from, action, (found) => {
        rememberPending(from, action, found)
        resumed.current = found
        void settle(action, found, from)
      })
      let hash: Hex
      try {
        hash = await sendWalletAction(walletClient, action)
      } finally {
        watch.stop()
      }
      rememberPending(from, action, hash)
      resumed.current = hash
      await settle(action, hash, from)
    } catch (error) {
      // a wallet that errors after its transaction was already found on chain does not undo that transaction
      if (settling.current) return
      setState({ status: 'error', error: classifyWalletError(error) })
    }
  }, [chainId, publicClient, walletClient, settle])

  const reset = useCallback(() => {
    settling.current = null
    setState({ status: 'idle' })
  }, [])

  return { execute, resume, reset, state, ready: Boolean(walletClient && publicClient && chainId) }
}

type BlockReader = NonNullable<ReturnType<typeof usePublicClient>>

/** Polls new blocks for the exact call (same sender, target and data) and reports its hash once. */
export function watchForSent(
  client: Pick<BlockReader, 'getBlockNumber' | 'getBlock'>,
  from: string,
  action: Pick<EncodedWalletAction, 'to' | 'data'>,
  onFound: (hash: Hex) => void,
  intervalMs = 2000,
): { stop: () => void } {
  let live = true
  let next: bigint | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  const tick = async () => {
    if (!live) return
    try {
      const head = await client.getBlockNumber()
      if (next === null) next = head + 1n
      // never scan more than a handful of blocks per tick
      for (let n = next > head - 20n ? next : head - 20n; n <= head && live; n++) {
        const block = await client.getBlock({ blockNumber: n, includeTransactions: true })
        const hit = block.transactions.find(
          (t) => typeof t === 'object' && t.from?.toLowerCase() === from.toLowerCase() && t.to?.toLowerCase() === action.to.toLowerCase() && t.input?.toLowerCase() === action.data.toLowerCase(),
        )
        next = n + 1n
        if (hit && typeof hit === 'object') {
          live = false
          onFound(hit.hash)
          return
        }
      }
    } catch {
      // a failed read just waits for the next tick
    }
    if (live) timer = setTimeout(tick, intervalMs)
  }
  timer = setTimeout(tick, 0)
  return {
    stop: () => {
      live = false
      if (timer) clearTimeout(timer)
    },
  }
}
