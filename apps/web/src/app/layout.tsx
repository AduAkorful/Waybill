import type { Metadata } from 'next'
import { Archivo, IBM_Plex_Mono } from 'next/font/google'
import './globals.css'

const archivo = Archivo({ subsets: ['latin'], axes: ['wdth'], variable: '--font-archivo' })
const plexMono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-plex-mono' })

// Absolute base for link-preview URLs (og:image, og:url). Set WAYBILL_SITE_URL to the public address of this site;
// when unset, previews fall back to the address the server is listening on.
const siteUrl = process.env.WAYBILL_SITE_URL?.trim()

export const metadata: Metadata = {
  ...(siteUrl ? { metadataBase: new URL(siteUrl) } : {}),
  title: { default: 'Waybill', template: '%s · Waybill' },
  description: 'Pay overseas suppliers in stages, released when named people confirm.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${archivo.variable} ${plexMono.variable}`} suppressHydrationWarning>
      <body className="min-h-dvh">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:rounded-md focus:bg-ink focus:px-3 focus:py-2 focus:text-[13px] focus:text-paper">
          Skip to content
        </a>
        <div id="main" tabIndex={-1} className="outline-none">
          {children}
        </div>
      </body>
    </html>
  )
}
