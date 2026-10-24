import { describe, expect, test } from 'bun:test'

import { privateKeyToAccount } from 'viem/accounts'
import { handleApiRequest, type WaybillApiOptions } from './api'
import { LabelError, LabelService, formatRanges, labelMessage, normalizeRanges, type DealLabel, type DealRange } from './deal-labels'

const escrow = `0x${'cd'.repeat(20)}` as `0x${string}`
const context = { network: 'testnet', chainId: 5042002, escrow }
const pauser = privateKeyToAccount(`0x${'11'.repeat(32)}`)
const other = privateKeyToAccount(`0x${'22'.repeat(32)}`)
const NOW = 1_800_000_000

function setup(over: { total?: bigint; pauserAddress?: `0x${string}` } = {}) {
  const writes: { ranges: readonly DealRange[]; label: string; isTest: boolean }[] = []
  const service = new LabelService({
    context,
    store: { setLabels: async (ranges, label, isTest) => (writes.push({ ranges, label, isTest }), Number(ranges.reduce((n, [a, b]) => n + (b - a + 1n), 0n))) },
    readPauser: async () => over.pauserAddress ?? pauser.address,
    readTotalDeals: async () => over.total ?? 300n,
    now: () => NOW,
  })
  return { service, writes }
}

async function request(account: typeof pauser, ranges: DealRange[], label: DealLabel, signedAt = NOW) {
  return {
    signer: account.address,
    signedAt,
    ranges,
    label,
    signature: await account.signMessage({ message: labelMessage(context, ranges, label, signedAt) }),
  }
}

describe('deal label message', () => {
  test('is exactly this text (the web app asserts the same string)', () => {
    expect(labelMessage(context, [[0n, 278n], [281n, 281n]], 'team', 1_800_000_000)).toBe(
      [
        'Waybill deal label',
        'network: testnet',
        'chain: 5042002',
        `escrow: ${escrow}`,
        'deals: 0-278,281',
        'label: team',
        'signed: 1800000000',
      ].join('\n'),
    )
  })
  test('single deals are written without a range', () => {
    expect(formatRanges([[5n, 5n]])).toBe('5')
  })
})

describe('ranges', () => {
  test('are sorted, and overlaps, inversions and empty lists are refused', () => {
    expect(normalizeRanges([[10n, 12n], [0n, 3n]])).toEqual([[0n, 3n], [10n, 12n]])
    for (const bad of [[], [[3n, 1n]], [[0n, 5n], [5n, 9n]], [[0n, 20_000n]]] as DealRange[][]) {
      expect(() => normalizeRanges(bad)).toThrow(LabelError)
    }
  })
})

describe('label service', () => {
  test('the pauser can label a range of deals', async () => {
    const { service, writes } = setup()
    const result = await service.set(await request(pauser, [[0n, 278n]], 'team'))
    expect(result).toEqual({ labelled: 279, label: 'team' })
    expect(writes).toEqual([{ ranges: [[0n, 278n]], label: 'team', isTest: true }])
  })

  test('third-party is the only label that is not test volume', async () => {
    const { service, writes } = setup()
    await service.set(await request(pauser, [[1n, 1n]], 'third-party'))
    expect(writes[0]!.isTest).toBe(false)
  })

  test('refuses a wallet that is not the pauser, even with a valid signature', async () => {
    const { service, writes } = setup()
    await expect(service.set(await request(other, [[0n, 5n]], 'team'))).rejects.toMatchObject({ code: 'not_pauser', status: 403 })
    expect(writes).toEqual([])
  })

  test('refuses a signature made for different deals or a different label', async () => {
    const { service, writes } = setup()
    const signed = await request(pauser, [[0n, 5n]], 'team')
    await expect(service.set({ ...signed, ranges: [[0n, 6n]] })).rejects.toMatchObject({ code: 'signature_mismatch' })
    await expect(service.set({ ...signed, label: 'third-party' })).rejects.toMatchObject({ code: 'signature_mismatch' })
    expect(writes).toEqual([])
  })

  test('refuses an expired signature, an unknown label and a deal that does not exist yet', async () => {
    const { service, writes } = setup({ total: 10n })
    await expect(service.set(await request(pauser, [[0n, 5n]], 'team', NOW - 3600))).rejects.toMatchObject({ code: 'signature_expired' })
    await expect(service.set({ ...(await request(pauser, [[0n, 5n]], 'team')), label: 'whale' })).rejects.toMatchObject({ code: 'invalid_label' })
    await expect(service.set(await request(pauser, [[0n, 10n]], 'team'))).rejects.toMatchObject({ code: 'unknown_deal' })
    expect(writes).toEqual([])
  })

  test('fails closed when the chain cannot be read', async () => {
    const service = new LabelService({
      context,
      store: { setLabels: async () => 0 },
      readPauser: async () => {
        throw new Error('rpc down')
      },
      readTotalDeals: async () => 10n,
      now: () => NOW,
    })
    await expect(service.set(await request(pauser, [[0n, 1n]], 'team'))).rejects.toMatchObject({ code: 'chain_read_unavailable', status: 503 })
  })
})

describe('labels route', () => {
  const options = (service: LabelService | null): WaybillApiOptions => ({
    network: 'testnet',
    allowedOrigins: ['https://app.example'],
    health: async () => ({ live: true, ready: true, components: [] }),
    readDeal: async () => null,
    readDealEvents: async () => [],
    listAttestors: async () => [],
    readAttestor: async () => null,
    listWalletDeals: async () => [],
    labels: service,
  })
  const post = async (service: LabelService | null, body: unknown, signed: Awaited<ReturnType<typeof request>> | null) =>
    handleApiRequest(
      {
        method: 'POST',
        url: '/v1/operator/labels',
        headers: signed
          ? { 'x-waybill-signer': signed.signer, 'x-waybill-signature': signed.signature, 'x-waybill-signed-at': String(signed.signedAt) }
          : {},
        body: new TextEncoder().encode(JSON.stringify(body)),
      },
      options(service),
    )

  test('accepts a signed body from the pauser and reports how many deals were labelled', async () => {
    const { service } = setup()
    const signed = await request(pauser, [[0n, 9n]], 'test')
    const res = await post(service, { ranges: [[0, 9]], label: 'test' }, signed)
    expect(res).toMatchObject({ status: 200, body: { labelled: 10, label: 'test' } })
  })

  test('is POST only, needs a signature, and is unavailable without a service', async () => {
    const { service } = setup()
    const signed = await request(pauser, [[0n, 9n]], 'test')
    expect((await handleApiRequest({ method: 'GET', url: '/v1/operator/labels' }, options(service))).status).toBe(405)
    expect((await post(service, { ranges: [[0, 9]], label: 'test' }, null)).status).toBe(401)
    expect((await post(null, { ranges: [[0, 9]], label: 'test' }, signed)).status).toBe(503)
    expect((await post(service, { ranges: 'all', label: 'test' }, signed)).status).toBe(400)
  })

  test('a wallet that is not the pauser gets 403', async () => {
    const { service } = setup()
    const signed = await request(other, [[0n, 9n]], 'test')
    expect((await post(service, { ranges: [[0, 9]], label: 'test' }, signed)).status).toBe(403)
  })
})
