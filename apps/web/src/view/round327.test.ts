import { describe, expect, test } from 'bun:test'
import { statementTime } from './attest-time'
import { formatUntil } from './format'
import { describeEvent, historyRows } from './timeline'
import { groupHistory } from './attestor'
import type { DealEvent } from './types'

const ev = (name: string, tx: string, args: Record<string, unknown> = {}, position: number | null = 0): DealEvent =>
  ({ name, position, blockNumber: 1n, logIndex: 0n, txHash: tx as `0x${string}`, time: 1n, args })

describe('statementTime', () => {
  test('uses the chain when the device clock is behind', async () => {
    expect(await statementTime({ getBlock: async () => ({ timestamp: 2_000n }) }, 1_000_000)).toBe(2_000n)
  })
  test('uses the device clock when it is ahead, or the chain cannot be read', async () => {
    expect(await statementTime({ getBlock: async () => ({ timestamp: 500n }) }, 1_000_000)).toBe(1_000n)
    expect(await statementTime({ getBlock: async () => { throw new Error('x') } }, 1_000_000)).toBe(1_000n)
    expect(await statementTime(undefined, 1_000_000)).toBe(1_000n)
  })
})

describe('far deadlines', () => {
  test('a deadline more than ten years off is not shown as a bare date', () => {
    const now = 1_800_000_000n
    expect(formatUntil(now + 86_400n, now)).not.toContain('years')
    expect(formatUntil(now + 300n * 365n * 86_400n, now)).toContain('more than 10 years from now')
  })
})

describe('history wording', () => {
  test('arbiter fee credit reads in words', () => {
    expect(describeEvent(ev('ArbiterFeeCredited', '0x1', { amount: '1000000' }, null))).toBe('Arbiter fee 1.00 USDC credited to the arbiter (claimable until they withdraw it)')
  })
  test('a panel decision is said once on the record and in the room', () => {
    const evs = [ev('PanelVoteCast', '0xa', { vote: 2 }), ev('PanelVoteCast', '0xb', { vote: 2 }), ev('PanelResolved', '0xb', { winningVote: 2 }), ev('DisputeResolved', '0xb', { toSupplier: true })]
    const g = groupHistory(evs, describeEvent).map((x) => x.text)
    expect(g.some((t) => t.startsWith('The arbiter decided'))).toBe(false)
    const rows = historyRows(evs).map((r) => r.text)
    expect(rows.length).toBe(2)
    expect(rows[0]).toContain('voted')
    expect(rows.join(' ')).not.toContain('The arbiter decided')
  })
})
