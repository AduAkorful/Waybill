'use client'

import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { createWaybillApiClient, loadBrowserApiBaseUrl } from '@/integration/api'
import { getBrowserNetwork } from '@/integration/network'
import { parseWalletDeals, type WalletDeal } from '@/view/wallet'

export type WalletDealsRead =
  | { status: 'loading' }
  | { status: 'unconfigured' }
  | { status: 'error'; message: string }
  | { status: 'ready'; deals: WalletDeal[] }

const Context = createContext<WalletDealsRead | null>(null)

/** Every deal that names a wallet, from the relayer's index. One read shared by the whole signed-in shell. */
export function WalletDealsProvider({ address, children }: { address: string; children: React.ReactNode }) {
  const network = useMemo(() => getBrowserNetwork(), [])
  const [read, setRead] = useState<WalletDealsRead>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    setRead({ status: 'loading' })
    let api: ReturnType<typeof createWaybillApiClient>
    try {
      api = createWaybillApiClient(loadBrowserApiBaseUrl(), fetch, network)
    } catch {
      setRead({ status: 'unconfigured' })
      return
    }
    api
      .getWalletDeals(address)
      .then((raw) => {
        if (!cancelled) setRead({ status: 'ready', deals: parseWalletDeals(raw) })
      })
      .catch((e) => {
        if (!cancelled) setRead({ status: 'error', message: e instanceof Error ? e.message : String(e) })
      })
    return () => {
      cancelled = true
    }
  }, [address, network])

  return <Context.Provider value={read}>{children}</Context.Provider>
}

export function useWalletDeals(): WalletDealsRead {
  const value = useContext(Context)
  if (!value) throw new Error('useWalletDeals must be used inside WalletDealsProvider')
  return value
}
