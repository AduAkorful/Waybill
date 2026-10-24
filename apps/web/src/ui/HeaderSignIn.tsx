'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

/**
 * Public pages carry no wallet code, so this only looks for the sign-in token the wallet library leaves in the
 * browser. With one, the link says "Your deals"; it never reads or sends anything from it.
 */
export function HeaderSignIn({ onlyWhenSignedIn = false, className }: { onlyWhenSignedIn?: boolean; className?: string }) {
  const [signedIn, setSignedIn] = useState(false)
  useEffect(() => {
    try {
      setSignedIn(localStorage.getItem('privy:token') !== null)
    } catch {}
  }, [])
  if (onlyWhenSignedIn && !signedIn) return null
  return (
    <Link href={signedIn ? '/app' : '/signin'} className={className ?? "inline-flex min-h-11 items-center rounded-md border border-rule px-1.5 text-[13px] min-[360px]:px-3 font-semibold whitespace-nowrap hover:bg-sheet"}>
      {signedIn ? <><span className="min-[400px]:hidden">Deals</span><span className="hidden min-[400px]:inline">Your deals</span></> : 'Sign in'}
    </Link>
  )
}
