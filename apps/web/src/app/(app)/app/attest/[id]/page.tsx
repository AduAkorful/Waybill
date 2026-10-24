import { AttestScreen } from './AttestScreen'

export default async function AttestPage({ params }: { params: Promise<{ id: string }> }) {
  return <AttestScreen idText={(await params).id} />
}
