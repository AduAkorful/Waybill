import { describe, expect, test } from 'bun:test'

import { readDealParties } from './parties'

const a = (n: number) => `0x${n.toString(16).padStart(40, '0')}` as `0x${string}`
const ZERO = a(0)

function chain(calls: { functionName: string; blockNumber?: bigint; args?: readonly unknown[] }[], panel = [ZERO, ZERO, ZERO]) {
  return {
    escrow: a(99),
    client: {
      readContract: async (p: { functionName: string; blockNumber?: bigint; args?: readonly unknown[] }) => {
        calls.push(p)
        if (p.functionName === 'getDeal') return { buyer: a(1), supplier: a(2), arbiter: a(3), milestoneCount: 2 }
        if (p.functionName === 'getAttestors') return p.args![1] === 0 ? [a(10)] : [a(11), a(12)]
        if (p.functionName === 'getPanelMembers') return panel
        throw new Error('unexpected read')
      },
    },
  } as never
}

describe('deal parties', () => {
  test('reads every named role at the creation block, including attestors who have not accepted', async () => {
    const calls: { functionName: string; blockNumber?: bigint }[] = []
    const parties = await readDealParties(chain(calls), 7n, 123n)
    expect(parties).toEqual([
      { address: a(1), role: 'buyer', milestoneIndex: null },
      { address: a(2), role: 'supplier', milestoneIndex: null },
      { address: a(3), role: 'arbiter', milestoneIndex: null },
      { address: a(10), role: 'attestor', milestoneIndex: 0 },
      { address: a(11), role: 'attestor', milestoneIndex: 1 },
      { address: a(12), role: 'attestor', milestoneIndex: 1 },
    ])
    expect(calls.every((c) => c.blockNumber === 123n)).toBe(true)
  })

  test('adds panel members and ignores empty panel slots', async () => {
    const parties = await readDealParties(chain([], [a(20), ZERO, a(22)]), 7n, 1n)
    expect(parties.filter((p) => p.role === 'panel').map((p) => p.address)).toEqual([a(20), a(22)])
  })

  test('fails whole when any read fails', async () => {
    const broken = { escrow: a(99), client: { readContract: async () => { throw new Error('rpc') } } } as never
    await expect(readDealParties(broken, 1n, 1n)).rejects.toThrow('rpc')
  })
})
