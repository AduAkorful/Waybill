import type { BrowserEnvironment } from './integration/network'

function viteEnvironment(): BrowserEnvironment {
  return import.meta.env as BrowserEnvironment
}

function required(environment: BrowserEnvironment, name: string): string {
  const value = environment[name]?.trim()
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

/**
 * Public Privy configuration only. No authorization key, server signer, or
 * wallet execution permission belongs in the browser bundle.
 */
export function getPrivyProviderProps(environment: BrowserEnvironment = viteEnvironment()) {
  const clientId = environment.VITE_PRIVY_CLIENT_ID?.trim()

  return {
    appId: required(environment, 'VITE_PRIVY_APP_ID'),
    ...(clientId ? { clientId } : {}),
    config: {
      embeddedWallets: {
        ethereum: {
          createOnLogin: 'users-without-wallets' as const,
        },
      },
    },
  }
}
