'use client'

import { getReadClient } from '@/integration/read-client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createWaybillApiClient, loadBrowserApiBaseUrl } from '@/integration/api'
import { getBrowserChain, getBrowserNetwork } from '@/integration/network'
import { readPublicTerms } from '@/integration/terms'
import { parseDealEvents, withEvents } from '@/view/events'
import { loadDealView } from '@/view/from-chain'
import type { DealView } from '@/view/types'

/** How often an open deal is read again. Changes between reads animate; it is not a business value. */
const REREAD_MS = 30_000
/** After a transaction the first read waits a moment so the shared read cache cannot hand back the old state. */
const AFTER_TX_MS = 2_600
/** and twice more, because the shared cache can still hold the old state on the first look */
const AFTER_TX_AGAIN_MS = [7_000, 15_000]

/** The last good read of each deal in this visit, shown at once while a fresh read runs. Memory only. */
const lastRead = new Map<string, { deal: DealView; history: HistoryStatus }>()

/** Why the history is missing, so a screen can say so instead of showing an empty timeline. */
export type HistoryStatus =
  | { status: 'ready' }
  | { status: 'unconfigured' }
  | { status: 'error'; message: string }

export type DealRead =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  /** `fresh` is false while a remembered read is shown and a new one is on its way */
  | { status: 'ready'; deal: DealView; history: HistoryStatus; fresh?: boolean }

/**
 * One deal, read from the escrow, with its indexed history from the relayer when the API is configured.
 * The escrow read is the truth; a failed or missing history never hides the deal, and is reported next to it.
 */
export function useDeal(id: bigint | null, refreshKey = 0, initial?: DealView | null): DealRead {
  const network = useMemo(() => getBrowserNetwork(), [])
  const client = useMemo(() => getReadClient(), [])
  const [read, setRead] = useState<DealRead>(() => {
    if (initial) return { status: 'ready', deal: initial, history: { status: 'unconfigured' } }
    const remembered = id === null ? undefined : lastRead.get(String(id))
    return remembered ? { status: 'ready', ...remembered, fresh: false } : { status: 'loading' }
  })
  // the server-rendered deal counts as already shown, so the first client read replaces it without a loading flash
  const shownId = useRef<bigint | null>(initial ? initial.id : null)

  useEffect(() => {
    if (id === null) return
    let cancelled = false
    // a refresh keeps the deal on screen; only a different deal resets to loading
    if (shownId.current !== id) {
      const remembered = lastRead.get(String(id))
      setRead(remembered ? { status: 'ready', ...remembered, fresh: false } : { status: 'loading' })
    }
    shownId.current = id

    const api = (() => {
      try {
        return createWaybillApiClient(loadBrowserApiBaseUrl(), fetch, network)
      } catch {
        return null
      }
    })()

    const run = async () => {
      try {
        // The chain read, the public details and the history all start together; none waits for another.
        // Details the buyer chose to make public; private ones are read on request with a signature.
        const termsRead = api ? readPublicTerms(id).then((t) => t?.terms).catch(() => undefined) : Promise.resolve(undefined)
        const eventsRead = api ? api.getDealEvents(id).then((raw) => parseDealEvents(raw)) : null
        eventsRead?.catch(() => undefined)
        const view = await loadDealView(client, network, id, termsRead)
        let deal = view
        let history: HistoryStatus = { status: 'unconfigured' }
        if (eventsRead) {
          try {
            deal = withEvents(view, await eventsRead)
            history = { status: 'ready' }
          } catch (e) {
            history = { status: 'error', message: e instanceof Error ? e.message : String(e) }
          }
        }
        lastRead.set(String(id), { deal, history })
        if (!cancelled) setRead({ status: 'ready', deal, history, fresh: true })
      } catch (e) {
        if (!cancelled) {
          // keep showing the last good read on a later failure; only a first read fails the screen
          setRead((prev) =>
            prev.status === 'ready' ? prev : { status: 'error', message: e instanceof Error ? e.message : String(e) },
          )
        }
      }
    }

    // the first read after a transaction (refreshKey above zero) waits a moment; later reads, and the first one, go at once
    const first = setTimeout(() => void run(), refreshKey > 0 ? AFTER_TX_MS : 0)
    const again = refreshKey > 0 ? AFTER_TX_AGAIN_MS.map((ms) => setTimeout(() => void run(), ms)) : []
    // a hidden tab does not poll: nobody is looking, and the free RPC's limit is shared
    const timer = setInterval(() => {
      if (!document.hidden) void run()
    }, REREAD_MS)
    return () => {
      cancelled = true
      clearTimeout(first)
      again.forEach(clearTimeout)
      clearInterval(timer)
    }
  }, [client, network, id, refreshKey])

  return read
}
