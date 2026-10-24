import type { Metadata } from 'next'
import { SupplierLink } from './SupplierLink'

// The preview carries no deal terms: an unfunded deal is not public, and the link is the invitation.
export const metadata: Metadata = {
  title: 'Review and accept a deal · Waybill',
  description: 'You have been invited to a Waybill deal. Review the terms and accept.',
  robots: { index: false },
}

export default async function SupplierPage({ params }: { params: Promise<{ id: string }> }) {
  return <SupplierLink idText={(await params).id} />
}
