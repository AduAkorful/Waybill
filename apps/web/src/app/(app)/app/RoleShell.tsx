'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { usePrivy } from '@privy-io/react-auth'
import { useWalletDeals } from '@/data/wallet-deals'
import { ThemeToggle, Wordmark } from '@/ui/Chrome'
import { shortAddress } from '@/view/format'
import { heldShells, shellLabel } from '@/view/wallet'

/** One frame for every role: header nav on desktop, a bottom tab bar on phones. Only roles the wallet really holds are offered. */
export function RoleShell({ address, children }: { address: string; children: React.ReactNode }) {
  const path = usePathname()
  const { logout } = usePrivy()
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
    <div className="flex min-h-dvh flex-col pb-16 md:pb-0">
      <header className="sticky top-0 z-30 border-b border-rule bg-paper/95 backdrop-blur">
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 md:px-6">
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
              onClick={() => void logout()}
              className="rounded-full border border-rule px-2.5 py-1 text-[10.5px] text-graphite uppercase hover:text-ink"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <div className="flex-1">{children}</div>
      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-rule bg-paper/95 backdrop-blur md:hidden" aria-label="Main">
        {nav.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            aria-current={n.active ? 'page' : undefined}
            className={`flex-1 py-3 text-center text-[12.5px] ${n.active ? 'font-semibold text-ink' : 'text-graphite'}`}
          >
            {n.label}
          </Link>
        ))}
      </nav>
    </div>
  )
}
