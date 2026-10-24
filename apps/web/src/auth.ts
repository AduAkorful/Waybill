'use client'

/**
 * The one import point for sign-in hooks. Normally these are Privy's own hooks, unchanged. With the dev-only
 * NEXT_PUBLIC_WAYBILL_DEV_WALLET_AUTH=1 flag (see integration/dev-wallet-flag.ts) they are thin wagmi stand-ins:
 * "signed in" means an injected wallet is connected. The choice is a build-time constant, so hook order never changes.
 */
import {
  useLogin as privyUseLogin,
  useLoginWithEmail as privyUseLoginWithEmail,
  usePrivy as privyUsePrivy,
  useWallets as privyUseWallets,
} from '@privy-io/react-auth'
import { useSetActiveWallet as privyUseSetActiveWallet } from '@privy-io/wagmi'
import { useCallback } from 'react'
import { useAccount, useConnect, useDisconnect } from 'wagmi'
import { injected } from 'wagmi/connectors'
import { DEV_WALLET_AUTH, DEV_WALLET_SESSION_KEY } from './integration/dev-wallet-flag'

function useDevLogin() {
  const { connectAsync } = useConnect()
  return useCallback(async () => {
    await connectAsync({ connector: injected() })
    try { localStorage.setItem(DEV_WALLET_SESSION_KEY, '1') } catch {}
  }, [connectAsync])
}

function useDevPrivy() {
  const { address, status } = useAccount()
  const { disconnectAsync } = useDisconnect()
  const login = useDevLogin()
  const logout = useCallback(async () => {
    try { localStorage.removeItem(DEV_WALLET_SESSION_KEY) } catch {}
    await disconnectAsync()
  }, [disconnectAsync])
  return {
    ready: status !== 'reconnecting' && status !== 'connecting',
    // a wallet that is already connected stays signed in while wagmi re-checks it ('reconnecting' with the address
    // kept); treating that as signed out made the /d tiles and banners flicker between "you" and a stranger
    authenticated: status === 'connected' || (status === 'reconnecting' && !!address),
    user: address ? { id: `dev-wallet:${address}` } : null,
    login: () => void login(),
    connectOrCreateWallet: () => void login(),
    logout,
  }
}

function useDevWallets() {
  const { address } = useAccount()
  return { ready: true, wallets: address ? [{ address }] : [] }
}

function useDevLoginHook() {
  const login = useDevLogin()
  return { login: () => void login() }
}

function useDevLoginWithEmail() {
  const unavailable = async () => { throw new Error('Email sign-in is off in dev wallet mode; connect a wallet instead.') }
  return { sendCode: unavailable, loginWithCode: unavailable, state: { status: 'initial' as const } }
}

function useDevSetActiveWallet() {
  return { setActiveWallet: async () => {} }
}

export const usePrivy = (DEV_WALLET_AUTH ? useDevPrivy : privyUsePrivy) as unknown as typeof privyUsePrivy
export const useWallets = (DEV_WALLET_AUTH ? useDevWallets : privyUseWallets) as unknown as typeof privyUseWallets
export const useLogin = (DEV_WALLET_AUTH ? useDevLoginHook : privyUseLogin) as unknown as typeof privyUseLogin
export const useLoginWithEmail = (DEV_WALLET_AUTH ? useDevLoginWithEmail : privyUseLoginWithEmail) as unknown as typeof privyUseLoginWithEmail
export const useSetActiveWallet = (DEV_WALLET_AUTH ? useDevSetActiveWallet : privyUseSetActiveWallet) as unknown as typeof privyUseSetActiveWallet
