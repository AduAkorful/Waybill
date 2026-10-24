import { describe, expect, test } from 'bun:test'

import { handleApiRequest } from './api'
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
