import { notFound } from 'next/navigation'
import { ReadOnly } from './read-only'

export const dynamic = 'force-dynamic'

export default function ReadPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  return (
    <main className="min-h-dvh p-4">
      <ReadOnly dealId={0n} />
    </main>
  )
}
