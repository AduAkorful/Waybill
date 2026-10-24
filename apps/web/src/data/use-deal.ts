'use client'

import { useEffect, useMemo, useState } from 'react'
import { createPublicClient, http, type PublicClient } from 'viem'
import { createWaybillApiClient, loadBrowserApiBaseUrl } from '@/integration/api'
import { getBrowserChain, getBrowserNetwork } from '@/integration/network'
import { parseDealEvents, withEvents } from '@/view/events'
import { loadDealView } from '@/view/from-chain'
import type { DealView } from '@/view/types'

/** How often an open deal is read again. Changes between reads animate; it is not a business value. */
const REREAD_MS = 15_000

/** Why the history is missing, so a screen can say so instead of showing an empty timeline. */
export type HistoryStatus =
  | { status: 'ready' }
  | { status: 'unconfigured' }
  | { status: 'error'; message: string }

export type DealRead =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; deal: DealView; history: HistoryStatus }

/**
 * One deal, read from the escrow, with its indexed history from the relayer when the API is configured.
 * The escrow read is the truth; a failed or missing history never hides the deal, and is reported next to it.
 */
export function useDeal(id: bigint | null): DealRead {
  const network = useMemo(() => getBrowserNetwork(), [])
  const client = useMemo(
    () =>
      createPublicClient({
        chain: getBrowserChain(),
        transport: http(network.rpcUrl),
        batch: { multicall: true },
      }) as PublicClient,
    [network],
  )
  const [read, setRead] = useState<DealRead>({ status: 'loading' })

  useEffect(() => {
    if (id === null) return
    let cancelled = false
    setRead({ status: 'loading' })

    const api = (() => {
      try {
        return createWaybillApiClient(loadBrowserApiBaseUrl(), fetch, network)
      } catch {
        return null
      }
    })()

    const run = async () => {
      try {
        const view = await loadDealView(client, network, id)
        let deal = view
        let history: HistoryStatus = { status: 'unconfigured' }
        if (api) {
          try {
            deal = withEvents(view, parseDealEvents(await api.getDealEvents(id)))
            history = { status: 'ready' }
          } catch (e) {
            history = { status: 'error', message: e instanceof Error ? e.message : String(e) }
          }
        }
        if (!cancelled) setRead({ status: 'ready', deal, history })
      } catch (e) {
        if (!cancelled) {
          // keep showing the last good read on a later failure; only a first read fails the screen
          setRead((prev) =>
            prev.status === 'ready' ? prev : { status: 'error', message: e instanceof Error ? e.message : String(e) },
          )
        }
      }
    }

    void run()
    const timer = setInterval(run, REREAD_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [client, network, id])

  return read
}
