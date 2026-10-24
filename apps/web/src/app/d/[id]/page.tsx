import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getPublicDeal } from '@/server/deal'
import type { DealView } from '@/view/types'
import { SupplierLink } from './SupplierLink'

// The preview carries no deal terms: the link is the invitation. The page itself shows the terms, read from the
// escrow at render time so they are in the first HTML, before any script runs.
export const metadata: Metadata = {
  title: 'Review and accept a deal · Waybill',
  description: 'You have been invited to a Waybill deal. Review the terms and accept.',
  robots: { index: false },
}

export default async function SupplierPage({ params }: { params: Promise<{ id: string }> }) {
  const idText = (await params).id
  let initial: DealView | null = null
  if (!/^\d+$/.test(idText)) notFound()
  try {
    const read = await getPublicDeal(BigInt(idText))
    if (read.status === 'missing') notFound()
    if (read.status === 'ready') initial = read.deal
  } catch (error) {
    // notFound() throws to stop rendering; let it through
    if (error && typeof error === 'object' && 'digest' in error) throw error
    // otherwise the browser reads the escrow itself and reports a failure on the page
  }
  return <SupplierLink idText={idText} initial={initial} />
}
