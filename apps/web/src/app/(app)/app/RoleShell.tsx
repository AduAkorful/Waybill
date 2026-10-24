'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { usePrivy } from '@privy-io/react-auth'
import { useWalletDeals } from '@/data/wallet-deals'
import { ThemeToggle, Wordmark } from '@/ui/Chrome'
import { shortAddress } from '@/view/format'
import { heldShells, shellLabel } from '@/view/wallet'

/** Phone tab bar and desktop rail. Only places the wallet really holds a role are offered. */
export function RoleShell({ address, children }: { address: string; children: React.ReactNode }) {
  const path = usePathname()
  const { logout } = usePrivy()
  const read = useWalletDeals()
  const shells = read.status === 'ready' ? heldShells(read.deals) : []
  const items = [
    { href: '/app', label: 'Home', active: path === '/app' },
    ...shells.map((s) => ({ href: `/app/${s}`, label: shellLabel[s], active: path.startsWith(`/app/${s}`) })),
  ]

  return (
    <div className="flex min-h-dvh flex-col pb-16 md:flex-row md:pb-0">
      <aside className="hidden w-52 shrink-0 flex-col justify-between border-r border-rule bg-paper p-5 md:flex">
        <div>
          <Link href="/app" aria-label="Your deals">
            <Wordmark />
          </Link>
          <nav className="mt-8 flex flex-col gap-1 text-[13.5px]" aria-label="Main">
            {items.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                aria-current={n.active ? 'page' : undefined}
                className={`rounded-md px-2.5 py-1.5 ${n.active ? 'bg-sheet font-semibold text-ink' : 'text-graphite hover:text-ink'}`}
              >
                {n.label}
              </Link>
            ))}
            <Link href="/attestors" className="rounded-md px-2.5 py-1.5 text-graphite hover:text-ink">
              Attestor directory
            </Link>
          </nav>
        </div>
        <Account address={address} onLogout={() => void logout()} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-rule px-4 py-2.5 md:hidden">
          <Link href="/app" aria-label="Your deals">
            <Wordmark />
          </Link>
          <div className="flex items-center gap-2">
            <span className="mono text-[11.5px] text-graphite">{shortAddress(address)}</span>
            <ThemeToggle />
          </div>
        </header>
        <div className="hidden items-center justify-end gap-3 border-b border-rule px-6 py-2.5 md:flex">
          <ThemeToggle />
        </div>
        <div className="flex-1">{children}</div>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-rule bg-paper/95 backdrop-blur md:hidden" aria-label="Main">
        {items.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            aria-current={n.active ? 'page' : undefined}
            className={`flex-1 py-3 text-center text-[12.5px] ${n.active ? 'font-semibold text-ink' : 'text-graphite'}`}
          >
            {n.label}
          </Link>
        ))}
        <button type="button" onClick={() => void logout()} className="flex-1 py-3 text-center text-[12.5px] text-graphite">
          Sign out
        </button>
      </nav>
    </div>
  )
}

function Account({ address, onLogout }: { address: string; onLogout: () => void }) {
  return (
    <div className="text-[12.5px]">
      <p className="label">Signed in</p>
      <p className="mono mt-1 break-all text-graphite" title={address}>
        {shortAddress(address)}
      </p>
      <button type="button" onClick={onLogout} className="mt-3 text-graphite underline hover:text-ink">
        Sign out
      </button>
    </div>
  )
}
