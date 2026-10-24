'use client'

import { PrivyProvider } from '@privy-io/react-auth'
import { WagmiProvider } from '@privy-io/wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { getWagmiConfig } from '@/config'
import { getPrivyProviderProps } from '@/privy'
import { useSiteTheme } from './theme'

/** Wallet, chain and query providers. Only signed-in app routes load them, so public pages stay light. */
export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient())
  const theme = useSiteTheme()
  const privy = getPrivyProviderProps()
  return (
    <PrivyProvider {...privy} config={{ ...privy.config, appearance: { theme } }}>
      <QueryClientProvider client={queryClient}>
        <WagmiProvider config={getWagmiConfig()}>{children}</WagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  )
}
