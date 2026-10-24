import { AppGate } from './AppGate'

export const metadata = { title: 'Your deals · Waybill', robots: { index: false } }

export default function SignedInLayout({ children }: { children: React.ReactNode }) {
  return <AppGate>{children}</AppGate>
}
