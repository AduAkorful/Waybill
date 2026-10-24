/**
 * wagmi configuration. Built lazily: the module is imported by routes that Next evaluates at build time, when the
 * NEXT_PUBLIC_ variables may be absent, so nothing here may run at import.
 */

import { createConfig } from '@privy-io/wagmi'
import { http } from 'wagmi'
import { getBrowserChain, getBrowserNetwork } from './integration/network'

let cached: ReturnType<typeof build> | undefined

function build() {
  const network = getBrowserNetwork()
  const chain = getBrowserChain()
  return createConfig({
    chains: [chain],
    transports: { [chain.id]: http(network.rpcUrl) },
  })
}

export function getWagmiConfig() {
  cached ??= build()
  return cached
}
