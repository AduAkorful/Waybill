'use client'

import { useEffect } from 'react'

type Injected = {
  on?: (event: 'accountsChanged', handler: (accounts: string[]) => void) => void
  removeListener?: (event: 'accountsChanged', handler: (accounts: string[]) => void) => void
}

/**
 * When the person switches account inside their wallet app, this page's wallet state can lag behind (the header and
 * open dialogs keep the old address). Anything on screen built for the old account is wrong, so the page reloads and
 * starts again from the new one.
 */
export function useReloadOnAccountChange(current: string | undefined): void {
  useEffect(() => {
    if (!current) return
    const ethereum = (window as unknown as { ethereum?: Injected }).ethereum
    if (!ethereum?.on) return
    const handler = (accounts: string[]) => {
      const next = accounts[0]
      if (next && next.toLowerCase() !== current.toLowerCase()) window.location.reload()
    }
    ethereum.on('accountsChanged', handler)
    return () => ethereum.removeListener?.('accountsChanged', handler)
  }, [current])
}
