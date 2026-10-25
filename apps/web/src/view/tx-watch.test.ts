import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { watchForSent } from '../components/use-waybill-transaction'

const from = '0x4632A278FEb0a4D249561e7fC3f3708C4329D0F1'
const to = '0xD046abd137EbaD5E284d5a39a67BEdE04C08A9D2'
const data = '0xabcdef' as const
const hash = `0x${'11'.repeat(32)}` as const

describe('a wallet that answers late', () => {
  test('the sent call is found on chain and its hash reported once', async () => {
    let head = 100n
    const client = {
      getBlockNumber: async () => head,
      getBlock: async ({ blockNumber }: { blockNumber: bigint }) => ({
        transactions: blockNumber === 101n ? [{ from: from.toLowerCase(), to: to.toLowerCase(), input: data, hash }] : [{ from, to, input: '0x00', hash: `0x${'22'.repeat(32)}` }],
      }),
    }
    const found: string[] = []
    const w = watchForSent(client as never, from, { to, data }, (h) => found.push(h), 5)
    await new Promise((r) => setTimeout(r, 20))
    head = 102n
    await new Promise((r) => setTimeout(r, 40))
    w.stop()
    expect(found).toEqual([hash])
  })

  test('another call from the same wallet is not taken for this one', async () => {
    const client = { getBlockNumber: async () => 5n, getBlock: async () => ({ transactions: [{ from, to, input: '0x1234', hash }] }) }
    const found: string[] = []
    const w = watchForSent(client as never, from, { to, data }, (h) => found.push(h), 5)
    await new Promise((r) => setTimeout(r, 30))
    w.stop()
    expect(found).toEqual([])
  })
})

describe('mainnet run copy and flow fixes', () => {
  const read = (p: string) => readFileSync(join(import.meta.dir, '..', p), 'utf8')
  test('arbiter accepts from the deal page, not via the room', () => {
    const s = read('ui/NamedPartyBanner.tsx')
    expect(s).toContain("kind: 'acceptArbiter'")
    expect(s).not.toContain('/app/room/')
  })
  test('confirm delivery says the buyer can release now or the supplier is paid when the review ends', () => {
    const s = read('app/(app)/app/deals/[id]/DealScreen.tsx')
    expect(s).toContain('paid automatically when the review ends')
    expect(s).toContain('Approve and release')
  })
  test('the payout address is shortened in the middle with the full value on hover', () => {
    const s = read('ui/AddressChanges.tsx')
    expect(s).toContain('middleTruncate(value)')
    expect(s).toContain('title={value}')
  })
})
