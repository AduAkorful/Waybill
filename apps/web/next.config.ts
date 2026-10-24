import type { NextConfig } from 'next'

const origin = (value: string | undefined): string | null => {
  try {
    return value ? new URL(value).origin : null
  } catch {
    return null
  }
}

// What the page talks to: itself, the relayer API, the chain RPC, and the sign-in and wallet providers.
const connect = [
  "'self'",
  origin(process.env.NEXT_PUBLIC_WAYBILL_API_BASE_URL),
  origin(process.env.NEXT_PUBLIC_WAYBILL_MAINNET_RPC_URL) ?? 'https://rpc.testnet.arc.io',
  'https://auth.privy.io',
  'https://*.privy.io',
  'wss://relay.walletconnect.com',
  'wss://relay.walletconnect.org',
  'https://*.walletconnect.com',
  'https://*.walletconnect.org',
].filter((o): o is string => o !== null)

// Report-only: browsers log what this policy would have blocked and block nothing. Next's inline bootstrap scripts
// need 'unsafe-inline' until nonces are added; enforce this once a QA pass shows no violations on the real flows.
const reportOnly = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://auth.privy.io https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src ${connect.join(' ')}`,
  'frame-src https://auth.privy.io https://verify.walletconnect.com https://verify.walletconnect.org https://challenges.cloudflare.com',
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
