'use client'

import { getReadClient } from '@/integration/read-client'
import { useEffect, useMemo, useState } from 'react'
import { getBrowserChain, getBrowserNetwork } from '@/integration/network'
import { loadDealView } from '@/view/from-chain'
import type { DealView } from '@/view/types'

/** Deals read at once. The public RPC rate-limits bursts, so a long list is read in small groups. */
const GROUP = 3

export type DealViewRead = { status: 'ready'; deal: DealView } | { status: 'error'; message: string }

/** Each listed deal read from the escrow. A deal that fails to read is reported by itself and never hides the others. */
export function useDealViews(ids: readonly bigint[]): { done: boolean; reads: Map<string, DealViewRead> } {
  const network = useMemo(() => getBrowserNetwork(), [])
  const client = useMemo(
    () => getReadClient(),
    [network],
  )
  const key = ids.map(String).join(',')
  const [state, setState] = useState<{ done: boolean; reads: Map<string, DealViewRead> }>({ done: false, reads: new Map() })

  useEffect(() => {
    let cancelled = false
    setState({ done: false, reads: new Map() })
    const run = async () => {
      const reads = new Map<string, DealViewRead>()
      for (let i = 0; i < ids.length; i += GROUP) {
        await Promise.all(
          ids.slice(i, i + GROUP).map(async (id) => {
            try {
              reads.set(String(id), { status: 'ready', deal: await loadDealView(client, network, id) })
            } catch (e) {
              reads.set(String(id), { status: 'error', message: e instanceof Error ? e.message : String(e) })
            }
          }),
        )
        if (cancelled) return
        setState({ done: false, reads: new Map(reads) })
      }
      if (!cancelled) setState({ done: true, reads })
    }
    void run()
    return () => {
      cancelled = true
    }
    // ids is represented by its key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, client, network])

  return state
}
