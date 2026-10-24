import Link from 'next/link'
import { shortAddress } from '@/view/format'

/** Said where a pauser-only control would be: who can use it, and a way in for someone not signed in yet. */
export function PauserOnly({ pauser, address, what, link = true }: { pauser: string; address: string | undefined; what: string; link?: boolean }) {
  return (
    <div className="mt-3 text-[12.5px] text-graphite">
      <p>
        Only the pauser wallet <span className="mono">{shortAddress(pauser)}</span> can {what}
        {address ? ` (you are connected as ${shortAddress(address)}).` : '.'}
      </p>
      {address || !link ? null : (
        <Link href="/signin?next=/operator" className="mt-2 inline-flex min-h-11 items-center rounded-md border border-rule px-3 text-[13px] font-semibold text-ink hover:bg-paper">
          Sign in with the pauser wallet
        </Link>
      )}
    </div>
  )
}
