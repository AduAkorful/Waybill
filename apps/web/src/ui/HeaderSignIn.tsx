'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

/**
 * Public pages carry no wallet code, so this only looks for the sign-in token the wallet library leaves in the
 * browser. With one, the link says "Your deals"; it never reads or sends anything from it.
 */
export function HeaderSignIn() {
  const [signedIn, setSignedIn] = useState(false)
  useEffect(() => {
    try {
      setSignedIn(localStorage.getItem('privy:token') !== null)
    } catch {}
  }, [])
  return (
    <Link href={signedIn ? '/app' : '/signin'} className="inline-flex min-h-11 items-center rounded-md border border-rule px-3 text-[13px] font-semibold whitespace-nowrap hover:bg-sheet md:min-h-0 md:py-1.5">
      {signedIn ? 'Your deals' : 'Sign in'}
    </Link>
  )
}
