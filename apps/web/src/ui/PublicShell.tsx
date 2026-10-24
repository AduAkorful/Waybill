import { SiteFooter } from './SiteFooter'
import { SiteHeader } from './SiteHeader'

/** Header and footer for the public pages. Links point only at pages that exist. */
export function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col overflow-x-clip">
      <SiteHeader />
      <div className="flex-1">{children}</div>
      <SiteFooter />
    </div>
  )
}
