import { describe, expect, test } from 'bun:test'
import { ARC_TESTNET } from '@waybill/network/networks'
import {
  createWaybillApiClient,
  loadBrowserApiBaseUrl,
  WaybillApiError,
} from './api'

describe('read-only frontend API boundary', () => {
  test('requires an HTTP(S) API base URL', () => {
    expect(() => loadBrowserApiBaseUrl({})).toThrow(
      'NEXT_PUBLIC_WAYBILL_API_BASE_URL',
    )
    expect(() =>
      loadBrowserApiBaseUrl({ NEXT_PUBLIC_WAYBILL_API_BASE_URL: 'file:///tmp/api' }),
    ).toThrow('http or https')
    expect(
      loadBrowserApiBaseUrl({ NEXT_PUBLIC_WAYBILL_API_BASE_URL: 'https://api.example///' }),
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

  test('reads a deal events from the events route', async () => {
    const requests: string[] = []
    const client = createWaybillApiClient(
      'https://api.example',
      async (input) => {
        requests.push(String(input))
        return new Response(JSON.stringify([]), { status: 200 })
      },
      ARC_TESTNET,
    )
    await expect(client.getDealEvents(12n)).resolves.toEqual([])
    expect(requests).toEqual(['https://api.example/v1/deals/12/events'])
    await expect(client.getDealEvents(-1n)).rejects.toThrow('cannot be negative')
  })

  test('reads a wallet deals and refuses a malformed address before any request', async () => {
    const requests: string[] = []
    const client = createWaybillApiClient(
      'https://api.example',
      async (input) => {
        requests.push(String(input))
        return new Response('[]', { status: 200 })
      },
      ARC_TESTNET,
    )
    const wallet = `0x${'ab'.repeat(20)}`
    await expect(client.getWalletDeals(wallet)).resolves.toEqual([])
    expect(requests).toEqual([`https://api.example/v1/wallets/${wallet}/deals`])
    await expect(client.getWalletDeals('0x12')).rejects.toThrow('Invalid wallet address')
    expect(requests).toHaveLength(1)
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
