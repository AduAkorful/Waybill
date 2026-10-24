/**
 * DEV/QA ONLY. When NEXT_PUBLIC_WAYBILL_DEV_WALLET_AUTH is exactly "1" at build time, the app skips Privy and signs in
 * by connecting the browser's injected wallet (Rabby, MetaMask) through wagmi. Used for the local Anvil fork stack,
 * where Privy cannot work (unknown origin, forked chain). Never set it on a deployed build.
 */
export const DEV_WALLET_AUTH = process.env.NEXT_PUBLIC_WAYBILL_DEV_WALLET_AUTH === '1'
export const DEV_WALLET_SESSION_KEY = 'wb-dev-wallet'
