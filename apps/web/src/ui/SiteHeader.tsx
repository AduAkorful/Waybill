import Link from 'next/link'
import { ThemeToggle, Wordmark } from './Chrome'
import { HeaderSignIn } from './HeaderSignIn'

/**
 * The one header for every page that is not inside the signed-in app: logo, Attestors, Sign in and the theme button
 * in the same places, so only the page's own control (`extra`, such as the language switch) differs.
 */
export function SiteHeader({ extra, signIn = true, max = 'max-w-6xl' }: { extra?: React.ReactNode; signIn?: boolean; max?: string }) {
  return (
    <header className={`mx-auto flex w-full ${max} items-center justify-between gap-2 px-4 py-2 md:gap-4 md:px-8 md:py-4`}>
      <Link href="/" aria-label="Waybill home" className="inline-flex min-h-11 items-center">
        <Wordmark className="text-[17px]" />
      </Link>
      <div className="flex flex-wrap items-center justify-end gap-x-2 md:gap-x-5">
        <Link href="/attestors" className="inline-flex min-h-11 items-center px-1 text-[13.5px] text-graphite hover:text-ink">
          Attestors
        </Link>
        {extra}
        {signIn ? (
          <HeaderSignIn />
        ) : null}
        <ThemeToggle />
      </div>
    </header>
  )
}
