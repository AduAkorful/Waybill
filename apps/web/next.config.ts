import type { NextConfig } from 'next'

const config: NextConfig = {
  reactStrictMode: true,
  // The shared network package ships TypeScript source, so Next must compile it.
  transpilePackages: ['@waybill/network'],
}

export default config
