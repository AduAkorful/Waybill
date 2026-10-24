'use client'

import { useState } from 'react'
import { usePrivy } from '@/auth'

/**
 * Sign out that always ends signed out. The wallet library's own logout can fail (it asks its server to end the
 * session); when it does, this still clears what the browser holds and reloads, so the person is not left signed in
 * with a button that did nothing.
 */
export function useSignOut(to: string | null = '/'): { signOut: () => Promise<void>; signingOut: boolean } {
  const { logout } = usePrivy()
  const [signingOut, setSigningOut] = useState(false)
  const signOut = async () => {
    if (signingOut) return
    setSigningOut(true)
    try {
      await logout()
    } catch {
      // cleared below
    }
    try {
      for (const key of Object.keys(localStorage)) if (key.startsWith('privy:') || key.startsWith('privy-')) localStorage.removeItem(key)
      sessionStorage.clear()
    } catch {}
    if (to === null) window.location.reload()
    else window.location.assign(to)
  }
  return { signOut, signingOut }
}
