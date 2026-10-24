/**
 * wagmi configuration. Built lazily: the module is imported by routes that Next evaluates at build time, when the
 * NEXT_PUBLIC_ variables may be absent, so nothing here may run at import.
 */

import { createConfig } from '@privy-io/wagmi'
import { getBrowserChain, getBrowserNetwork } from './integration/network'
import { readTransport } from './integration/read-client'

let cached: ReturnType<typeof build> | undefined

function build() {
  const network = getBrowserNetwork()
  const chain = getBrowserChain()
  return createConfig({
    chains: [chain],
    transports: { [chain.id]: readTransport() },
  })
}

export function getWagmiConfig() {
  cached ??= build()
  return cached
}
