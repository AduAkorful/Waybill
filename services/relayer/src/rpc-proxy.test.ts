import { describe, expect, test } from 'bun:test'
import { clientOf } from './api'
import { ClientRateLimiter, httpUpstream, ReadRpcProxy, type Upstream } from './rpc-proxy'
import { handleApiRequest } from './api'

const call = (method: string, params: unknown[] = [], id = 1) => ({ jsonrpc: '2.0', id, method, params })

describe('read-only rpc proxy', () => {
  test('identical reads inside the window share one upstream call; the id is the caller\'s own', async () => {
    let calls = 0
    let t = 0
    const up: Upstream = async () => (calls++, { result: '0x1' })
    const proxy = new ReadRpcProxy(up, () => t)
    const a = await proxy.handle(call('eth_blockNumber', [], 7))
    const b = await proxy.handle(call('eth_blockNumber', [], 9))
    expect(calls).toBe(1)
    expect(a.body).toEqual({ jsonrpc: '2.0', id: 7, result: '0x1' })
    expect(b.body).toEqual({ jsonrpc: '2.0', id: 9, result: '0x1' })
    t += 2_500
    await proxy.handle(call('eth_blockNumber'))
    expect(calls).toBe(2)
  })

  test('a read already in flight is joined, not repeated', async () => {
    let calls = 0
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const up: Upstream = async () => (calls++, await gate, { result: '0x2' })
    const proxy = new ReadRpcProxy(up)
    const both = Promise.all([proxy.handle(call('eth_call', [{ to: '0x1' }, 'latest'])), proxy.handle(call('eth_call', [{ to: '0x1' }, 'latest'], 2))])
    release()
    await both
    expect(calls).toBe(1)
  })

  test('only read methods are forwarded; sending a transaction is refused', async () => {
    let calls = 0
    const proxy = new ReadRpcProxy(async () => (calls++, { result: '0x' }))
    for (const m of ['eth_sendRawTransaction', 'eth_sendTransaction', 'personal_sign', 'debug_traceCall', 'eth_newFilter', 'anvil_setBalance']) {
      const r = (await proxy.handle(call(m))).body as { error: { code: number } }
      expect(r.error.code).toBe(-32601)
    }
    expect(calls).toBe(0)
  })

  test('an empty answer and an error are not kept', async () => {
    let calls = 0
    const proxy = new ReadRpcProxy(async () => (calls++, calls === 1 ? { result: null } : { error: { code: 3, message: 'execution reverted' } }))
    await proxy.handle(call('eth_getTransactionReceipt', ['0xab']))
    const second = (await proxy.handle(call('eth_getTransactionReceipt', ['0xab']))).body as { error: { message: string } }
    expect(second.error.message).toBe('execution reverted')
    await proxy.handle(call('eth_getTransactionReceipt', ['0xab']))
    expect(calls).toBe(3)
  })

  test('a block-pinned read is kept longer than a latest read', async () => {
    let calls = 0
    let t = 0
    const proxy = new ReadRpcProxy(async () => (calls++, { result: '0x5' }), () => t)
    await proxy.handle(call('eth_call', [{ to: '0x1' }, '0x10']))
    t += 30_000
    await proxy.handle(call('eth_call', [{ to: '0x1' }, '0x10']))
    expect(calls).toBe(1)
  })

  test('the reads a create preflight makes are forwarded; gas estimates and nonces are never kept', async () => {
    let calls = 0
    const proxy = new ReadRpcProxy(async (m) => (calls++, { result: m === 'eth_getCode' ? '0x60' : '0x5208' }))
    const ask = async (method: string, params: unknown[]) => ((await proxy.handle({ jsonrpc: '2.0', id: 1, method, params })).body as { result?: unknown; error?: { code: number } })
    for (const m of ['eth_estimateGas', 'eth_getTransactionCount', 'eth_gasPrice', 'eth_maxPriorityFeePerGas', 'eth_feeHistory', 'eth_getCode']) {
      expect((await ask(m, [])).error).toBeUndefined()
    }
    const before = calls
    await ask('eth_estimateGas', [{ to: '0x1' }])
    await ask('eth_estimateGas', [{ to: '0x1' }])
    await ask('eth_getTransactionCount', ['0x1', 'pending'])
    await ask('eth_getTransactionCount', ['0x1', 'pending'])
    expect(calls - before).toBe(4)
  })

  test('a call with no params field (as viem sends eth_gasPrice) is answered', async () => {
    const proxy = new ReadRpcProxy(async () => ({ result: '0x1' }))
    expect(((await proxy.handle({ jsonrpc: '2.0', id: 5, method: 'eth_gasPrice' })).body as { result?: unknown }).result).toBe('0x1')
    expect(((await proxy.handle({ jsonrpc: '2.0', id: 5, method: 'eth_gasPrice', params: 'x' })).body as { error?: { code: number } }).error?.code).toBe(-32600)
  })

  test('log scans and raw storage reads are refused: the app never needs them, and they are the costly ones', async () => {
    let calls = 0
    const proxy = new ReadRpcProxy(async () => (calls++, { result: [] }))
    for (const [method, params] of [['eth_getLogs', [{ fromBlock: '0x1', toBlock: '0x2' }]], ['eth_getStorageAt', ['0x1', '0x0', 'latest']]] as const) {
      expect(((await proxy.handle({ jsonrpc: '2.0', id: 1, method, params: [...params] })).body as { error?: { code: number } }).error?.code).toBe(-32601)
    }
    expect(calls).toBe(0)
  })

  test('each client has its own budget per minute; heavy calls count 5 and a batch counts every call', () => {
    let t = 0
    const limiter = new ClientRateLimiter(10, () => t)
    expect(ClientRateLimiter.cost([call('eth_call'), call('eth_estimateGas')])).toBe(6)
    expect(limiter.allow('a', 6)).toBe(true)
    expect(limiter.allow('a', 5)).toBe(false)
    expect(limiter.allow('a', 4)).toBe(true)
    expect(limiter.allow('b', 10)).toBe(true)
    t += 60_000
    expect(limiter.allow('a', 10)).toBe(true)
  })

  test('the client is read from X-Forwarded-For only as far as the trusted proxies wrote it', () => {
    const req = (xff?: string) => ({ headers: xff ? { 'x-forwarded-for': xff } : {}, socket: { remoteAddress: '10.0.0.9' } })
    expect(clientOf(req('6.6.6.6, 1.2.3.4'), 1)).toBe('1.2.3.4')
    expect(clientOf(req('6.6.6.6, 1.2.3.4, 10.0.0.2'), 2)).toBe('1.2.3.4')
    expect(clientOf(req('1.2.3.4'), 0)).toBe('10.0.0.9')
    expect(clientOf(req(), 1)).toBe('10.0.0.9')
  })

  test('batches are answered in order and bounded', async () => {
    const proxy = new ReadRpcProxy(async (m) => ({ result: m }))
    const out = (await proxy.handle([call('eth_chainId', [], 1), call('eth_blockNumber', [], 2)])).body as { id: number; result: string }[]
    expect(out.map((o) => [o.id, o.result])).toEqual([[1, 'eth_chainId'], [2, 'eth_blockNumber']])
    expect((await proxy.handle(Array.from({ length: 33 }, () => call('eth_chainId')))).status).toBe(400)
  })

  test('upstream retries a rate limit and then gives a plain answer', async () => {
    let n = 0
    const fetcher = (async () => (n++, new Response('{}', { status: 429 }))) as unknown as typeof fetch
    const up = httpUpstream('http://rpc', fetcher, async () => {})
    const r = await up('eth_blockNumber', [])
    expect(n).toBe(3)
    expect('error' in r && r.error.code).toBe(-32005)
  })

  test('the route needs a POST body and a configured proxy', async () => {
    const base = { network: 'testnet' as const, health: async () => ({ live: true, ready: true, components: [] }) } as never as Parameters<typeof handleApiRequest>[1]
    expect((await handleApiRequest({ method: 'GET', url: '/v1/rpc' }, base)).status).toBe(405)
    expect((await handleApiRequest({ method: 'POST', url: '/v1/rpc', body: new TextEncoder().encode('{}') }, base)).status).toBe(503)
    const withRpc = { ...(base as object), rpc: new ReadRpcProxy(async () => ({ result: '0x1' })) } as never as Parameters<typeof handleApiRequest>[1]
    expect((await handleApiRequest({ method: 'POST', url: '/v1/rpc', body: new TextEncoder().encode('not json') }, withRpc)).status).toBe(400)
    const ok = await handleApiRequest({ method: 'POST', url: '/v1/rpc', body: new TextEncoder().encode(JSON.stringify(call('eth_chainId'))) }, withRpc)
    expect(ok.status).toBe(200)
  })
})
