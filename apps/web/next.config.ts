import type { NextConfig } from 'next'

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
