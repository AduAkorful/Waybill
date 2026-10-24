/**
 * wagmi configuration. Built lazily: the module is imported by routes that Next evaluates at build time, when the
 * NEXT_PUBLIC_ variables may be absent, so nothing here may run at import.
 */

import { createConfig as privyCreateConfig } from '@privy-io/wagmi'
import { createConfig as wagmiCreateConfig } from 'wagmi'
import { injected } from 'wagmi/connectors'
import { DEV_WALLET_AUTH } from './integration/dev-wallet-flag'
import { getBrowserChain, getBrowserNetwork } from './integration/network'
import { readTransport } from './integration/read-client'

let cached: ReturnType<typeof build> | undefined

function build() {
  const network = getBrowserNetwork()
  const chain = getBrowserChain()
  // dev wallet mode (no Privy): plain wagmi with the injected connector
  if (DEV_WALLET_AUTH) {
    return wagmiCreateConfig({ chains: [chain], connectors: [injected()], transports: { [chain.id]: readTransport() } }) as unknown as ReturnType<typeof privyCreateConfig>
  }
  return privyCreateConfig({
    chains: [chain],
    transports: { [chain.id]: readTransport() },
  })
}

export function getWagmiConfig() {
  cached ??= build()
  return cached
}
