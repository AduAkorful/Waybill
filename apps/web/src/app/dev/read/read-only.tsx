'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { createConfig, http, WagmiProvider } from 'wagmi'
import { DealReader, NetworkReadiness } from '@/components'
import { getBrowserChain, getBrowserNetwork } from '@/integration/network'

/** Chain reads only: no Privy, no wallet. Lets the integration layer be checked without a Privy app id. */
export function ReadOnly({ dealId }: { dealId: bigint }) {
  const [queryClient] = useState(() => new QueryClient())
  const [config] = useState(() => {
    const chain = getBrowserChain()
    return createConfig({ chains: [chain], transports: { [chain.id]: http(getBrowserNetwork().rpcUrl) } })
  })
  return (
    <QueryClientProvider client={queryClient}>
      <WagmiProvider config={config}>
        <NetworkReadiness />
        <DealReader dealId={dealId} />
      </WagmiProvider>
    </QueryClientProvider>
  )
}
