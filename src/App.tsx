import { DealReader, NetworkReadiness, WalletPanel } from './components'

export default function App() {
  return (
    <main className="min-h-dvh">
      <WalletPanel />
      <NetworkReadiness />
      <DealReader dealId={0n} />
    </main>
  )
}
