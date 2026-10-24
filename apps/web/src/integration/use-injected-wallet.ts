'use client'

import { useEffect, useState } from 'react'

export type InjectedWallet = 'checking' | 'found' | 'missing'

/** How long to wait for a browser wallet (Rabby, MetaMask) to announce itself before saying there is none. */
const LOOK_MS = 3000

/**
 * Whether this browser has a wallet extension. Extensions can inject late, so this listens for EIP-6963
 * announcements and MetaMask's `ethereum#initialized` for a few seconds before answering "missing".
 */
export function useInjectedWallet(): InjectedWallet {
  const [state, setState] = useState<InjectedWallet>('checking')
  useEffect(() => {
    const has = () => typeof window !== 'undefined' && !!(window as { ethereum?: unknown }).ethereum
    if (has()) return setState('found')
    const found = () => setState('found')
    window.addEventListener('eip6963:announceProvider', found)
    window.addEventListener('ethereum#initialized', found)
    window.dispatchEvent(new Event('eip6963:requestProvider'))
    const t = setTimeout(() => setState((s) => (s === 'found' || has() ? 'found' : 'missing')), LOOK_MS)
    return () => {
      clearTimeout(t)
      window.removeEventListener('eip6963:announceProvider', found)
      window.removeEventListener('ethereum#initialized', found)
    }
  }, [])
  return state
}
