import { AppGate } from './AppGate'

export const metadata = { title: 'Your deals', robots: { index: false } }

export default function SignedInLayout({ children }: { children: React.ReactNode }) {
  return <AppGate>{children}</AppGate>
}
