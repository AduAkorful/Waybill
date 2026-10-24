import Link from 'next/link'
import { ThemeToggle, Wordmark } from './Chrome'
import { HeaderSignIn } from './HeaderSignIn'

/**
 * The one header for every page that is not inside the signed-in app: logo, Attestors, the page's own control
 * (`extra`, such as the language switch), the sign-in link and the theme button, always in that order.
 * On a phone the page's own control stays on the row, and Attestors steps aside when there is one.
 */
export function SiteHeader({
  extra,
  signIn = 'always',
  max = 'max-w-6xl',
  extraOnOwnRow = false,
}: {
  extra?: React.ReactNode
  /** "signed-in" shows the link only to someone who is signed in (the page has its own sign-in button) */
  signIn?: 'always' | 'signed-in'
  max?: string
  /** on a phone the page's control takes a row of its own under the logo */
  extraOnOwnRow?: boolean
}) {
  return (
    <header className={`mx-auto flex w-full ${max} flex-wrap items-center justify-between gap-x-1 min-[360px]:gap-x-2 px-4 py-2 md:gap-x-4 md:px-8 md:py-4`}>
      <Link href="/" aria-label="Waybill home" className="inline-flex min-h-11 items-center">
        <Wordmark className="text-[17px]" textOnWideOnly />
      </Link>
      {extra && extraOnOwnRow ? <div className="order-last flex w-full justify-end pb-1 sm:hidden">{extra}</div> : null}
      <div className="flex items-center justify-end gap-x-1 min-[360px]:gap-x-2 md:gap-x-5">
        <Link href="/attestors" className={`${extra ? 'hidden sm:inline-flex' : 'inline-flex'} min-h-11 items-center px-1 text-[13.5px] text-graphite hover:text-ink`}>
          Attestors
        </Link>
        {extra && !extraOnOwnRow ? extra : null}
        {extra && extraOnOwnRow ? <div className="hidden items-center gap-2 sm:flex">{extra}</div> : null}
        <HeaderSignIn onlyWhenSignedIn={signIn === 'signed-in'} />
        <ThemeToggle />
      </div>
    </header>
  )
}
