import { publicEnvironment } from './integration/env'
import type { BrowserEnvironment } from './integration/network'

function required(environment: BrowserEnvironment, name: string): string {
  const value = environment[name]?.trim()
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

/**
 * Public Privy configuration only. No authorization key, server signer, or
 * wallet execution permission belongs in the browser bundle.
 */
export function getPrivyProviderProps(environment: BrowserEnvironment = publicEnvironment()) {
  const clientId = environment.NEXT_PUBLIC_PRIVY_CLIENT_ID?.trim()

  return {
    appId: required(environment, 'NEXT_PUBLIC_PRIVY_APP_ID'),
    ...(clientId ? { clientId } : {}),
    config: {
      loginMethods: ['email' as const, 'wallet' as const],
      // Coinbase's smart wallet does not support Arc, so only plain wallet connections are offered through it
      externalWallets: { coinbaseWallet: { config: { preference: { options: 'eoaOnly' as const } } } },
      embeddedWallets: {
        ethereum: {
          createOnLogin: 'users-without-wallets' as const,
        },
      },
    },
  }
}
