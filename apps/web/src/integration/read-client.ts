import { createPublicClient, fallback, http, type PublicClient, type Transport } from 'viem'
import { loadBrowserApiBaseUrl } from './api'
import { getBrowserChain, getBrowserNetwork } from './network'

/**
 * Where the browser reads the chain from. First the relayer's read-only front, which shares and caches reads so many
 * people do not each spend the free public RPC's rate limit; if that is unreachable, the public RPC itself. Writes
 * never go through here: they are signed in the wallet and sent by it.
 */
export function readTransport(): Transport {
  const network = getBrowserNetwork()
  try {
    const base = loadBrowserApiBaseUrl()
    return fallback([http(`${base}/v1/rpc`, { retryCount: 1, timeout: 12_000 }), http(network.rpcUrl)], { rank: false })
  } catch {
    return http(network.rpcUrl)
  }
}

let shared: PublicClient | undefined

/** One read client for the whole page, so reads from different components batch into the same requests. */
export function getReadClient(): PublicClient {
  shared ??= createPublicClient({
    chain: getBrowserChain(),
    transport: readTransport(),
    batch: { multicall: { wait: 25 } },
  }) as PublicClient
  return shared
}
