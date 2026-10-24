import { usePrivy, useWallets } from '@privy-io/react-auth'
import { useSetActiveWallet } from '@privy-io/wagmi'
import { useAccount, useChainId } from 'wagmi'
import { getBrowserNetwork } from '../integration/network'

export function WalletPanel() {
  const { ready, authenticated, user, login, logout, connectOrCreateWallet } = usePrivy()
  const { wallets, ready: walletsReady } = useWallets()
  const { address, isConnected } = useAccount()
  const chainId = useChainId()
  const { setActiveWallet } = useSetActiveWallet()
  const expectedChain = getBrowserNetwork().chainId

  if (!ready || !walletsReady) return <p role="status">Loading wallet state…</p>

  if (!authenticated) {
    return (
      <section aria-labelledby="wallet-heading">
        <h2 id="wallet-heading">Wallet</h2>
        <button type="button" onClick={() => login()}>Log in with Privy</button>
      </section>
    )
  }

  return (
    <section aria-labelledby="wallet-heading">
      <h2 id="wallet-heading">Wallet</h2>
      <p>{user?.id ?? 'Authenticated'}</p>
      <p>
        Active wallet: {address ?? 'None'}
        {' · '}
        Chain: {chainId}
        {chainId === expectedChain ? ' (Arc selected)' : ' (switch required)'}
      </p>
      {!isConnected && (
        <button type="button" onClick={() => connectOrCreateWallet()}>
          Connect or create wallet
        </button>
      )}
      {wallets.length > 1 && (
        <label>
          Active wallet
          <select
            value={address ?? ''}
            onChange={(event) => {
              const wallet = wallets.find((candidate) => candidate.address === event.target.value)
              if (wallet) void setActiveWallet(wallet)
            }}
          >
            <option value="" disabled>Select a wallet</option>
            {wallets.map((wallet) => (
              <option key={wallet.address} value={wallet.address}>
                {wallet.address}
              </option>
            ))}
          </select>
        </label>
      )}
      <button type="button" onClick={() => void logout()}>Log out</button>
    </section>
  )
}
