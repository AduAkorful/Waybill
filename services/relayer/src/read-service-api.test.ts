import { describe, expect, test } from 'bun:test'

import { handleApiRequest, parseAllowedOrigins } from './api'
import type { HealthResult } from './health'
import { WaybillReadService } from './read-service'

const health: HealthResult = {
  live: true,
  ready: true,
  components: [],
}

const projection = {
  network: 'testnet' as const,
  dealId: 4n,
  state: 'FUNDED',
  lastBlockNumber: 10n,
  lastLogIndex: 2n,
}

function service(chainFailure = false) {
  return new WaybillReadService(
    {
      getDeal: async () => projection,
    },
    {
      readDeal: async () => {
        if (chainFailure) throw new Error('RPC down')
        return { state: 'FUNDED', currentLocked: 1_000n }
      },
    },
  )
}

describe('WaybillReadService', () => {
  test('prefers live chain data and includes the projection for indexing context', async () => {
    await expect(service().getDeal('testnet', 4n)).resolves.toEqual({
      network: 'testnet',
      dealId: 4n,
      source: 'chain',
      stale: false,
      live: { state: 'FUNDED', currentLocked: 1_000n },
      projection,
    })
  })

  test('returns an explicitly stale projection when chain reads fail', async () => {
    await expect(service(true).getDeal('testnet', 4n)).resolves.toMatchObject({
      source: 'projection',
      stale: true,
      warning: 'Live chain read failed; projection may be stale',
    })
  })

  test('rejects negative deal ids before touching dependencies', async () => {
    await expect(service().getDeal('testnet', -1n)).rejects.toThrow('non-negative')
  })
})

describe('read-only API boundary', () => {
  const options = {
    network: 'testnet' as const,
    health: async () => health,
    readDeal: async (dealId: bigint) => ({ dealId, currentLocked: 1_000n }),
    readDealEvents: async (dealId: bigint) => [
      { dealId, eventName: 'DealCreated', blockNumber: 12n, blockTimestamp: null },
    ],
    listAttestors: async () => [],
    readAttestor: async () => null,
    listWalletDeals: async () => [],
  }

  test('serves health, network, and BigInt-safe deal reads', async () => {
    await expect(handleApiRequest({ method: 'GET', url: '/health' }, options)).resolves.toEqual({
      status: 200,
      body: health,
    })
    await expect(handleApiRequest({ method: 'GET', url: '/v1/network' }, options)).resolves.toEqual({
      status: 200,
      body: { network: 'testnet' },
    })
    await expect(handleApiRequest({ method: 'GET', url: '/v1/deals/4' }, options)).resolves.toEqual({
      status: 200,
      body: { dealId: '4', currentLocked: '1000' },
    })
  })

  test('rejects writes and malformed/unknown routes', async () => {
    await expect(handleApiRequest({ method: 'POST', url: '/v1/deals/4' }, options)).resolves.toEqual({
      status: 405,
      body: { error: 'method_not_allowed' },
    })
    await expect(handleApiRequest({ method: 'GET', url: '/v1/deals/nope' }, options)).resolves.toEqual({
      status: 400,
      body: { error: 'invalid_deal_id' },
    })
    await expect(handleApiRequest({ method: 'GET', url: '/v1/unknown' }, options)).resolves.toEqual({
      status: 404,
      body: { error: 'not_found' },
    })
  })

  test('maps chain read failures to service unavailable', async () => {
    await expect(handleApiRequest({
      method: 'GET',
      url: '/v1/deals/4',
    }, { ...options, readDeal: async () => { throw new Error('down') } })).resolves.toEqual({
      status: 503,
      body: { error: 'chain_read_unavailable' },
    })
  })
})

describe('deal events route', () => {
  const options = {
    network: 'testnet' as const,
    health: async () => health,
    readDeal: async () => ({}),
    readDealEvents: async (dealId: bigint) => [
      { eventName: 'DealCreated', blockNumber: dealId + 10n, blockTimestamp: null },
    ],
  }

  test('serves indexed events with BigInt values as strings', async () => {
    await expect(
      handleApiRequest({ method: 'GET', url: '/v1/deals/4/events' }, options),
    ).resolves.toEqual({
      status: 200,
      body: [{ eventName: 'DealCreated', blockNumber: '14', blockTimestamp: null }],
    })
  })

  test('fails visibly when the read model is down and rejects bad ids and writes', async () => {
    const down = { ...options, readDealEvents: async () => { throw new Error('db down') } }
    expect((await handleApiRequest({ method: 'GET', url: '/v1/deals/4/events' }, down)).status).toBe(503)
    expect((await handleApiRequest({ method: 'GET', url: '/v1/deals/x/events' }, options)).status).toBe(400)
    expect((await handleApiRequest({ method: 'POST', url: '/v1/deals/4/events' }, options)).status).toBe(405)
  })
})

describe('attestor routes', () => {
  const who = `0x${'ab'.repeat(20)}`
  const options = {
    network: 'testnet' as const,
    health: async () => health,
    readDeal: async () => ({}),
    readDealEvents: async () => [],
    listAttestors: async () => [{ address: who, attested: 12, eta: 5n }],
    readAttestor: async (address: string) => (address === who ? { address, upheld: 1, events: [] } : null),
    listWalletDeals: async (address: string) => [{ dealId: 9n, address, roles: [{ role: 'buyer', milestoneIndex: null }] }],
  }
  const get = (url: string, o = options) => handleApiRequest({ method: 'GET', url }, o)

  test('lists attestors with BigInt-safe values', async () => {
    expect(await get('/v1/attestors')).toEqual({ status: 200, body: [{ address: who, attested: 12, eta: '5' }] })
  })

  test('serves a known attestor, 404s an unknown one, 400s a malformed address', async () => {
    expect((await get(`/v1/attestors/${who}`)).status).toBe(200)
    expect((await get(`/v1/attestors/0x${'cd'.repeat(20)}`)).status).toBe(404)
    expect((await get('/v1/attestors/nope')).status).toBe(400)
  })

  test('fails visibly when the registry or index is unavailable', async () => {
    const down = { ...options, listAttestors: async () => { throw new Error('rpc') }, readAttestor: async () => { throw new Error('rpc') } }
    expect((await get('/v1/attestors', down)).status).toBe(503)
    expect((await get(`/v1/attestors/${who}`, down)).status).toBe(503)
  })
})

describe('wallet deals route', () => {
  const who = `0x${'ab'.repeat(20)}`
  const options = {
    network: 'testnet' as const,
    health: async () => health,
    readDeal: async () => ({}),
    readDealEvents: async () => [],
    listAttestors: async () => [],
    readAttestor: async () => null,
    listWalletDeals: async (address: string) => [{ dealId: 9n, address, roles: [{ role: 'buyer', milestoneIndex: null }] }],
  }
  const get = (url: string, o = options) => handleApiRequest({ method: 'GET', url }, o)

  test('lists a wallet\'s deals with BigInt-safe ids', async () => {
    expect(await get(`/v1/wallets/${who}/deals`)).toEqual({
      status: 200,
      body: [{ dealId: '9', address: who, roles: [{ role: 'buyer', milestoneIndex: null }] }],
    })
  })

  test('rejects malformed addresses and other paths, and fails visibly when the index is down', async () => {
    expect((await get('/v1/wallets/nope/deals')).status).toBe(400)
    expect((await get(`/v1/wallets/${who}`)).status).toBe(400)
    const down = { ...options, listWalletDeals: async () => { throw new Error('db') } }
    expect((await get(`/v1/wallets/${who}/deals`, down)).status).toBe(503)
  })
})

describe('API CORS', () => {
  const options = {
    network: 'testnet' as const,
    allowedOrigins: ['https://app.example'],
    health: async () => health,
    readDeal: async () => ({ state: 'FUNDED' }),
    readDealEvents: async () => [],
    listAttestors: async () => [],
    readAttestor: async () => null,
    listWalletDeals: async () => [],
  }
  const get = (origin?: string, method = 'GET') =>
    handleApiRequest(
      { method, url: '/v1/network', headers: origin ? { origin } : {} },
      options,
    )

  test('allows a listed origin with an exact echo and Vary', async () => {
    const res = await get('https://app.example')
    expect(res.status).toBe(200)
    expect(res.headers?.['access-control-allow-origin']).toBe('https://app.example')
    expect(res.headers?.vary).toBe('Origin')
  })

  test('refuses an unlisted origin without CORS headers', async () => {
    const res = await get('https://evil.example')
    expect(res.status).toBe(403)
    expect(res.headers?.['access-control-allow-origin']).toBeUndefined()
  })

  test('serves requests with no Origin header and adds no CORS headers', async () => {
    const res = await get()
    expect(res.status).toBe(200)
    expect(res.headers?.['access-control-allow-origin']).toBeUndefined()
  })

  test('answers a preflight for a listed origin (GET and the signed evidence POST)', async () => {
    const res = await get('https://app.example', 'OPTIONS')
    expect(res.status).toBe(204)
    expect(res.headers?.['access-control-allow-methods']).toBe('GET, POST')
    expect((await get('https://evil.example', 'OPTIONS')).status).toBe(403)
  })

  test('still rejects writes from an allowed origin', async () => {
    expect((await get('https://app.example', 'POST')).status).toBe(405)
  })

  test('with no allowed origins every browser origin is refused', async () => {
    const res = await handleApiRequest(
      { method: 'GET', url: '/health', headers: { origin: 'https://app.example' } },
      { ...options, allowedOrigins: undefined },
    )
    expect(res.status).toBe(403)
  })
})

describe('parseAllowedOrigins', () => {
  test('parses, trims and de-duplicates exact origins', () => {
    expect(parseAllowedOrigins(' https://a.example, http://localhost:5173,https://a.example ')).toEqual([
      'https://a.example',
      'http://localhost:5173',
    ])
    expect(parseAllowedOrigins(undefined)).toEqual([])
    expect(parseAllowedOrigins('')).toEqual([])
  })

  test('rejects wildcards, paths, trailing slashes and other schemes', () => {
    for (const bad of ['*', 'https://a.example/', 'https://a.example/x', 'ftp://a.example', 'a.example']) {
      expect(() => parseAllowedOrigins(bad)).toThrow()
    }
  })
})
