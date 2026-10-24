import { DealScreen } from './DealScreen'

export default async function DealPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <DealScreen idText={id} />
}
