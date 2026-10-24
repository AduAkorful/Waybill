/**
 * A read-only JSON-RPC front for the chain, so many browsers share one set of upstream reads instead of each
 * hitting the free public RPC and its rate limit. Only a short list of read methods is forwarded; anything else
 * (including every way of sending a transaction) is refused. Identical reads inside a short window share one
 * upstream call, and a read already in flight is joined rather than repeated.
 */

type Json = unknown
interface RpcRequest {
  jsonrpc: '2.0'
  id: string | number | null
  method: string
  params: unknown[]
}
export type RpcAnswer = { jsonrpc: '2.0'; id: string | number | null; result: Json } | { jsonrpc: '2.0'; id: string | number | null; error: { code: number; message: string } }
export type Upstream = (method: string, params: unknown[]) => Promise<{ result: Json } | { error: { code: number; message: string } }>

/** How long an answer may be reused, by method. A block-pinned read never changes, so it is kept longer. */
const LATEST_TTL_MS: Record<string, number> = {
  eth_call: 3_000,
  eth_blockNumber: 2_000,
  eth_getBlockByNumber: 2_000,
  eth_getBalance: 3_000,
  eth_chainId: 3_600_000,
  eth_getTransactionReceipt: 60_000,
  eth_getTransactionByHash: 60_000,
  // what a wallet-free preflight needs before it asks the wallet to sign: never kept, only joined while in flight
  eth_estimateGas: 0,
  eth_getTransactionCount: 0,
  eth_gasPrice: 2_000,
  eth_maxPriorityFeePerGas: 2_000,
  eth_feeHistory: 2_000,
  eth_getCode: 30_000,
}
const PINNED_TTL_MS = 60_000
const MAX_BATCH = 32
const MAX_ENTRIES = 2_000

const isHexBlock = (v: unknown) => typeof v === 'string' && /^0x[0-9a-fA-F]+$/.test(v)

/** The block a read targets: the last parameter for calls and balances, the first for block lookups. */
function targetsPinnedBlock(method: string, params: unknown[]): boolean {
  if (method === 'eth_call' || method === 'eth_getBalance') return isHexBlock(params[1])
  if (method === 'eth_getBlockByNumber') return isHexBlock(params[0])
  if (method === 'eth_getCode' || method === 'eth_getTransactionCount') return isHexBlock(params[1])
  return false
}

export class ReadRpcProxy {
  private readonly cache = new Map<string, { expires: number; answer: Json }>()
  private readonly inflight = new Map<string, Promise<{ result: Json } | { error: { code: number; message: string } }>>()

  constructor(
    private readonly upstream: Upstream,
    private readonly now: () => number = Date.now,
  ) {}

  /** Parse and answer one request body: a single call or a batch. */
  async handle(payload: unknown): Promise<{ status: number; body: unknown }> {
    if (Array.isArray(payload)) {
      if (payload.length === 0 || payload.length > MAX_BATCH) return { status: 400, body: { error: 'invalid_batch' } }
      return { status: 200, body: await Promise.all(payload.map((p) => this.one(p))) }
    }
    return { status: 200, body: await this.one(payload) }
  }

  private async one(raw: unknown): Promise<RpcAnswer> {
    const r = raw as Partial<RpcRequest> | null
    const id = r && (typeof r.id === 'string' || typeof r.id === 'number') ? r.id : null
    if (!r || r.jsonrpc !== '2.0' || typeof r.method !== 'string' || (r.params !== undefined && !Array.isArray(r.params))) {
      return { jsonrpc: '2.0', id, error: { code: -32600, message: 'Invalid request' } }
    }
    const method = r.method
    if (!(method in LATEST_TTL_MS)) return { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not available on this endpoint' } }
    // viem leaves params out for a no-argument call such as eth_gasPrice or eth_blockNumber
    const params = r.params ?? []
    const key = `${method}:${JSON.stringify(params)}`

    const hit = this.cache.get(key)
    if (hit && hit.expires > this.now()) return { jsonrpc: '2.0', id, result: hit.answer }

    let pending = this.inflight.get(key)
    if (!pending) {
      pending = this.upstream(method, params).finally(() => this.inflight.delete(key))
      this.inflight.set(key, pending)
    }
    const answer = await pending
    if ('error' in answer) return { jsonrpc: '2.0', id, error: answer.error }
    // an empty answer (for example a receipt not mined yet) is never kept: the next ask must reach the chain
    if (answer.result !== null && answer.result !== undefined) {
      const ttl = targetsPinnedBlock(method, params) && method !== 'eth_estimateGas' ? PINNED_TTL_MS : LATEST_TTL_MS[method]!
      if (ttl > 0) this.remember(key, answer.result, ttl)
    }
    return { jsonrpc: '2.0', id, result: answer.result }
  }

  private remember(key: string, answer: Json, ttl: number): void {
    if (this.cache.size >= MAX_ENTRIES) {
      const now = this.now()
      for (const [k, v] of this.cache) if (v.expires <= now) this.cache.delete(k)
      if (this.cache.size >= MAX_ENTRIES) this.cache.delete(this.cache.keys().next().value as string)
    }
    this.cache.set(key, { expires: this.now() + ttl, answer })
  }
}

/** Calls the real RPC, retrying a rate-limited or briefly unavailable answer a couple of times with a short wait. */
export function httpUpstream(rpcUrl: string, fetcher: typeof fetch = fetch, sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))): Upstream {
  return async (method, params) => {
    let lastMessage = 'upstream unavailable'
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetcher(rpcUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
          signal: AbortSignal.timeout(10_000),
        })
        if (response.status === 429 || response.status >= 500) {
          lastMessage = `upstream status ${response.status}`
          await sleep(300 * 3 ** attempt)
          continue
        }
        const json = (await response.json()) as { result?: Json; error?: { code: number; message: string } }
        if (json.error) {
          // a rate-limit answer inside a 200 is retried like a 429; a revert or bad request is passed on as it is
          if (/rate limit|limit exceeded|too many/i.test(json.error.message)) {
            lastMessage = json.error.message
            await sleep(300 * 3 ** attempt)
            continue
          }
          return { error: json.error }
        }
        return { result: json.result ?? null }
      } catch (e) {
        lastMessage = e instanceof Error ? e.message : String(e)
        await sleep(300 * 3 ** attempt)
      }
    }
    return { error: { code: -32005, message: `Request limit or network trouble upstream: ${lastMessage}` } }
  }
}

/** Calls that cost the upstream more than a cached read: counted heavier against a client's budget. */
const HEAVY = new Set(['eth_estimateGas', 'eth_getTransactionCount'])
const MAX_CLIENTS = 10_000

/**
 * A per-client budget for the read front, so one visitor cannot spend the free upstream quota that every other
 * visitor's reads depend on. A fixed one-minute window per client; each call in a batch counts, heavy calls count 5.
 */
export class ClientRateLimiter {
  private readonly windows = new Map<string, { start: number; used: number }>()

  constructor(
    private readonly perMinute: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** The cost of one request body: the number of calls in it, with heavy calls weighted. */
  static cost(payload: unknown): number {
    const calls = Array.isArray(payload) ? payload : [payload]
    return calls.reduce<number>((n, c) => n + (HEAVY.has((c as { method?: unknown } | null)?.method as string) ? 5 : 1), 0)
  }

  /** True when the client may spend `cost` now; the spend is recorded only when allowed. */
  allow(client: string, cost: number): boolean {
    const now = this.now()
    let w = this.windows.get(client)
    if (!w || now - w.start >= 60_000) {
      if (!w && this.windows.size >= MAX_CLIENTS) {
        for (const [k, v] of this.windows) if (now - v.start >= 60_000) this.windows.delete(k)
        if (this.windows.size >= MAX_CLIENTS) this.windows.delete(this.windows.keys().next().value as string)
      }
      w = { start: now, used: 0 }
      this.windows.set(client, w)
    }
    if (w.used + cost > this.perMinute) return false
    w.used += cost
    return true
  }
}
