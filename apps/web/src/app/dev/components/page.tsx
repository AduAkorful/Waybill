import { notFound } from 'next/navigation'
import { Gallery } from './Gallery'

export const dynamic = 'force-dynamic'

export default function ComponentsPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  return <Gallery />
}
