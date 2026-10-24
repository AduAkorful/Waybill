import { notFound } from 'next/navigation'
import { DealReader, NetworkReadiness, WalletPanel } from '@/components'
import { TxCheck } from './TxCheck'

// Reads the environment at request time; never prerendered.
export const dynamic = 'force-dynamic'

/** The functional component harness from before the redesign. Development only; the real screens replace it. */
export default function Harness() {
  if (process.env.NODE_ENV === 'production') notFound()
  return (
    <main className="min-h-dvh p-4">
      <WalletPanel />
      <NetworkReadiness />
      <DealReader dealId={0n} />
      <TxCheck />
    </main>
  )
}
