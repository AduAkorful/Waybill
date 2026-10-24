import type { NextConfig } from 'next'

const origin = (value: string | undefined): string | null => {
  try {
    return value ? new URL(value).origin : null
  } catch {
    return null
  }
}

// What the page talks to: itself, the relayer API, the chain RPC, and the sign-in and wallet providers.
// The local fork stack signs in with the browser wallet only, so Privy and WalletConnect are left out there.
const devWallet = process.env.NEXT_PUBLIC_WAYBILL_DEV_WALLET_AUTH === '1'
// Dev-wallet sign-in skips Privy entirely; a hosted build (Vercel, Render) must never ship with it on.
if (devWallet && (process.env.VERCEL || process.env.RENDER)) {
  throw new Error('NEXT_PUBLIC_WAYBILL_DEV_WALLET_AUTH=1 is for the local fork only and is refused on a hosted build')
}
const providers = devWallet
  ? []
  : [
      'https://auth.privy.io',
      'https://*.privy.io',
      'wss://relay.walletconnect.com',
      'wss://relay.walletconnect.org',
      'https://*.walletconnect.com',
      'https://*.walletconnect.org',
    ]

const connect = [
  "'self'",
  origin(process.env.NEXT_PUBLIC_WAYBILL_API_BASE_URL),
  // a path-only setting (/rpc) is this site's own origin, already covered by 'self'
  process.env.NEXT_PUBLIC_WAYBILL_MAINNET_RPC_URL?.trim().startsWith('/') ? null : (origin(process.env.NEXT_PUBLIC_WAYBILL_MAINNET_RPC_URL) ?? 'https://rpc.testnet.arc.io'),
  ...providers,
].filter((o): o is string => o !== null)

// Report-only: browsers log what this policy would have blocked and block nothing. Next's inline bootstrap scripts
// need 'unsafe-inline' until nonces are added; enforce this once a QA pass shows no violations on the real flows.
const reportOnly = [
  "default-src 'self'",
  devWallet ? "script-src 'self' 'unsafe-inline'" : "script-src 'self' 'unsafe-inline' https://auth.privy.io https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src ${connect.join(' ')}`,
  devWallet ? "frame-src 'none'" : 'frame-src https://auth.privy.io https://verify.walletconnect.com https://verify.walletconnect.org https://challenges.cloudflare.com',
  "worker-src 'self' blob:",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
].join('; ')

// Only directives that cannot break Next's inline bootstrap or the wallet and sign-in providers' own frames and
// scripts: no plugins, no framing of Waybill by other sites, same-origin forms. A script-src policy needs
// per-request nonces and is left for a reviewed pass.
const policy = [
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join('; ')

const config: NextConfig = {
  // Dev/QA only: lets a second instance (the local fork stack) build into its own folder without touching .next
  distDir: process.env.WAYBILL_NEXT_DIST_DIR || '.next',
  reactStrictMode: true,
  poweredByHeader: false,
  // The shared network package ships TypeScript source, so Next must compile it.
  transpilePackages: ['@waybill/network'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: policy },
          { key: 'Content-Security-Policy-Report-Only', value: reportOnly },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
        ],
      },
    ]
  },
}

export default config
