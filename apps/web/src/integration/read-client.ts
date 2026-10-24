import { createPublicClient, custom, fallback, http, toHex, type PublicClient, type Transport } from 'viem'
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

/** How long reads stay pinned to a just-confirmed transaction's block. Longer than any cache on the read front. */
const PIN_MS = 10_000
let pinned: { block: bigint; until: number } | null = null

/**
 * Called when this page sees one of its own transactions confirmed. For a few seconds every 'latest' read is asked
 * at that block instead, so the shared read cache cannot answer with the state from before the transaction.
 */
export function noteConfirmedBlock(block: bigint, now = Date.now()): void {
  if (!pinned || block > pinned.block || pinned.until < now) pinned = { block, until: now + PIN_MS }
}

/** The request as sent: 'latest' (or no block) replaced by the pinned block while a pin is in force. */
export function pinRequest(method: string, params: unknown, now = Date.now()): unknown {
  if (!pinned || pinned.until < now || !Array.isArray(params)) return params
  const tag = toHex(pinned.block)
  const isLatest = (v: unknown) => v === undefined || v === 'latest'
  if ((method === 'eth_call' || method === 'eth_getBalance') && isLatest(params[1])) return [params[0], tag, ...params.slice(2)]
  if (method === 'eth_getBlockByNumber' && isLatest(params[0])) return [tag, ...params.slice(1)]
  return params
}

function pinning(inner: Transport): Transport {
  return (opts) => {
    const base = inner(opts)
    return custom({ request: ({ method, params }) => base.request({ method, params: pinRequest(method, params) } as never) })(opts)
  }
}

let shared: PublicClient | undefined

/** One read client for the whole page, so reads from different components batch into the same requests. */
export function getReadClient(): PublicClient {
  shared ??= createPublicClient({
    chain: getBrowserChain(),
    transport: pinning(readTransport()),
    batch: { multicall: { wait: 25 } },
  }) as PublicClient
  return shared
}
