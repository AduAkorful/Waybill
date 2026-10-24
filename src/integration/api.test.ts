import { describe, expect, test } from 'bun:test'
import { ARC_TESTNET } from '../../config/networks'
import {
  createWaybillApiClient,
  loadBrowserApiBaseUrl,
  WaybillApiError,
} from './api'

describe('read-only frontend API boundary', () => {
  test('requires an HTTP(S) API base URL', () => {
    expect(() => loadBrowserApiBaseUrl({})).toThrow(
      'VITE_WAYBILL_API_BASE_URL',
    )
    expect(() =>
      loadBrowserApiBaseUrl({ VITE_WAYBILL_API_BASE_URL: 'file:///tmp/api' }),
    ).toThrow('http or https')
    expect(
      loadBrowserApiBaseUrl({ VITE_WAYBILL_API_BASE_URL: 'https://api.example///' }),
    ).toBe('https://api.example')
  })

  test('reads the selected network and serializes deal ids in the URL', async () => {
    const requests: string[] = []
    const client = createWaybillApiClient(
      'https://api.example/',
      async (input) => {
        requests.push(String(input))
        return new Response(
          JSON.stringify(
            String(input).endsWith('/v1/network')
              ? { network: 'testnet' }
              : { dealId: '12', state: 1 },
          ),
          { status: 200 },
        )
      },
      ARC_TESTNET,
    )

    await expect(client.getNetwork()).resolves.toEqual({ network: 'testnet' })
    await expect(client.getDeal(12n)).resolves.toEqual({ dealId: '12', state: 1 })
    expect(requests).toEqual([
      'https://api.example/v1/network',
      'https://api.example/v1/deals/12',
    ])
  })

  test('rejects a backend on another network and non-success responses', async () => {
    const mismatch = createWaybillApiClient(
      'https://api.example',
      async () => new Response(JSON.stringify({ network: 'mainnet' }), { status: 200 }),
      ARC_TESTNET,
    )
    await expect(mismatch.getNetwork()).rejects.toMatchObject({
      status: 409,
      code: 'network_mismatch',
    })

    const failed = createWaybillApiClient(
      'https://api.example',
      async () => new Response(JSON.stringify({ error: 'chain_read_unavailable' }), { status: 503 }),
      ARC_TESTNET,
    )
    await expect(failed.getDeal(2n)).rejects.toBeInstanceOf(WaybillApiError)
  })

  test('rejects negative deal ids before an HTTP request', async () => {
    let called = false
    const client = createWaybillApiClient(
      'https://api.example',
      async () => {
        called = true
        return new Response('{}', { status: 200 })
      },
      ARC_TESTNET,
    )

    await expect(client.getDeal(-1n)).rejects.toThrow('cannot be negative')
    expect(called).toBe(false)
  })
})
