'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

/** On a mistyped address inside the signed-in app, offer the way back to the person's own deals. */
export function BackToApp() {
  const path = usePathname()
  if (!path.startsWith('/app')) return null
  return <Link href="/app" className="inline-flex min-h-11 items-center rounded-md bg-ink px-4 text-[14px] font-semibold text-paper">Back to your deals</Link>
}
