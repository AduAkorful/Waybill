import type { Metadata } from 'next'
import { PublicShell } from '@/ui/PublicShell'
import { VerifyEmail } from './VerifyEmail'

export const metadata: Metadata = { title: 'Confirm your email', robots: { index: false } }

export default async function Page({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams
  return (
    <PublicShell>
      <main className="mx-auto max-w-md px-4 py-16">
        <VerifyEmail token={typeof token === 'string' ? token : ''} />
      </main>
    </PublicShell>
  )
}
