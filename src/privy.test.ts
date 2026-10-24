import { describe, expect, test } from 'bun:test'
import { getPrivyProviderProps } from './privy'

describe('Privy browser boundary', () => {
  test('requires a public app id', () => {
    expect(() => getPrivyProviderProps({})).toThrow('VITE_PRIVY_APP_ID')
  })

  test('configures embedded wallets without server signing permissions', () => {
    const props = getPrivyProviderProps({
      VITE_PRIVY_APP_ID: 'clxxxxxxxxxxxxxxxxxxxxxxxx',
      VITE_PRIVY_CLIENT_ID: 'clientxxxxxxxxxxxxxxxx',
    })

    expect(props.appId).toBe('clxxxxxxxxxxxxxxxxxxxxxxxx')
    expect(props.clientId).toBe('clientxxxxxxxxxxxxxxxx')
    expect(props.config.embeddedWallets.ethereum.createOnLogin).toBe(
      'users-without-wallets',
    )
    expect(props).not.toHaveProperty('authorizationKey')
    expect(props).not.toHaveProperty('serverSigner')
  })
})
