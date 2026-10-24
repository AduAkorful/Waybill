import type { Metadata } from 'next'
import { getAttestors } from '@/server/attestors'
import { PublicShell } from '@/ui/PublicShell'
import type { Attestor } from '@/view/attestor'
import { Directory } from './Directory'

export const revalidate = 60
export const metadata: Metadata = {
  title: 'Attestors',
  description: 'People and firms who confirm statements on Waybill deals, with the registry’s own record of what they signed.',
}

export default async function Attestors() {
  const read = await getAttestors()
  return (
    <PublicShell>
      <main className="mx-auto max-w-6xl px-4 pt-6 pb-20 md:px-8">
        <p className="label">Directory</p>
        <h1 className="mt-1 text-[30px] font-semibold tracking-tight">Attestors</h1>
        <p className="mt-2 max-w-2xl text-[15px] text-graphite">
          Attestors confirm the statements that release each part of a deal. These figures are the registry contract’s own counts, not ratings.
        </p>
        {read.status === 'unconfigured' ? <p className="mt-6 text-graphite">This site has no attestor source configured, so no directory is shown.</p> : null}
        {read.status === 'error' ? <p role="alert" className="mt-6 text-hold">The directory is unavailable right now: {read.message}</p> : null}
        {read.status === 'ready' && read.value.length === 0 ? <p className="mt-6 text-graphite">No attestors have a registry record yet.</p> : null}
        {read.status === 'ready' && read.value.length > 0 ? <Directory attestors={[...read.value].sort((a, b) => b.attested - a.attested).map(plain)} /> : null}
      </main>
    </PublicShell>
  )
}

// bigint cannot cross to a client component; the directory needs only these fields
function plain(a: Attestor) {
  return {
    address: a.address,
    name: a.profile?.name || null,
    city: a.profile?.city || null,
    status: a.status,
    attested: a.attested,
    upheld: a.upheld,
    slashed: a.slashed,
  }
}
