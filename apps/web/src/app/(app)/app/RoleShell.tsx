'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useSignOut } from '@/components/use-sign-out'
import { useWalletDeals } from '@/data/wallet-deals'
import { ThemeToggle, Wordmark } from '@/ui/Chrome'
import { shortAddress } from '@/view/format'
import { heldShells, shellLabel } from '@/view/wallet'

/** One frame for every role: header nav on desktop, a bottom tab bar on phones. Only roles the wallet really holds are offered. */
export function RoleShell({ address, children }: { address: string; children: React.ReactNode }) {
  const path = usePathname()
  const { signOut, signingOut } = useSignOut()
  const read = useWalletDeals()
  const shells = read.status === 'ready' ? heldShells(read.deals) : []
  const nav = [
    ...shells.map((s) => ({ href: `/app/${s}`, label: shellLabel[s], active: path.startsWith(`/app/${s}`) })),
    ...(shells.includes('attestor')
      ? [
          { href: '/app/attestor/fees', label: 'Fees', active: path.startsWith('/app/attestor/fees') },
          { href: '/app/attestor/profile', label: 'Profile', active: path.startsWith('/app/attestor/profile') },
        ]
      : []),
    ...(shells.includes('arbiter') ? [{ href: '/app/arbiter/fees', label: 'Fees', active: path.startsWith('/app/arbiter/fees') }] : []),
    { href: '/app/new', label: 'New deal', active: path.startsWith('/app/new') },
    { href: '/app/settings', label: 'Settings', active: path.startsWith('/app/settings') },
    { href: '/attestors', label: 'Attestors', active: false },
  ]
  const current = shells.find((s) => path.startsWith(`/app/${s}`))

  return (
    <div className="flex min-h-dvh flex-col pb-[calc(2.85rem+env(safe-area-inset-bottom))] md:pb-0">
      <header className="sticky top-0 z-30 border-b border-rule bg-paper/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-2.5 md:px-8">
          <div className="flex items-center gap-7">
            <Link href="/app" className="flex items-baseline gap-2" aria-label="Your deals">
              <Wordmark />
              {current ? <span className="label hidden sm:inline">{shellLabel[current]}</span> : null}
            </Link>
            <nav className="hidden gap-5 text-[13px] md:flex" aria-label="Main">
              {nav.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  aria-current={n.active ? 'page' : undefined}
                  className={n.active ? 'font-semibold text-ink' : 'text-graphite hover:text-ink'}
                >
                  {n.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <span className="mono ml-1 hidden text-[12px] text-graphite sm:inline" title={address}>
              {shortAddress(address)}
            </span>
            <button
              type="button"
              onClick={() => void signOut()}
              disabled={signingOut}
              className="inline-flex min-h-11 items-center rounded-full border border-rule px-3 text-[12px] text-graphite uppercase hover:text-ink md:min-h-0 md:py-1"
            >
              {signingOut ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        </div>
      </header>
      <div className="mx-auto w-full max-w-6xl flex-1">{children}</div>
      <nav hidden={read.status === 'loading'} className="fixed inset-x-0 bottom-0 z-30 flex border-t border-rule bg-paper/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden" aria-label="Main">
        {nav.filter((n) => n.href !== '/attestors').map((n) => (
          <Link
            key={n.href}
            href={n.href}
            aria-current={n.active ? 'page' : undefined}
            className={`flex min-h-11 flex-1 items-center justify-center px-1 text-center text-[12px] leading-tight ${n.active ? 'font-semibold text-ink' : 'text-graphite'}`}
          >
            {n.label}
          </Link>
        ))}
      </nav>
    </div>
  )
}
