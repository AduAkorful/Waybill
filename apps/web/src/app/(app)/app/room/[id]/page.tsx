import { RoomScreen } from './RoomScreen'

export default async function RoomPage({ params }: { params: Promise<{ id: string }> }) {
  return <RoomScreen idText={(await params).id} />
}
