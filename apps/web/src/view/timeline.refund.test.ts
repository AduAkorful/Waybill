import { expect, test } from 'bun:test'
import { describeEvent } from './timeline'
import type { DealEvent } from './types'

const ev = (args: Record<string, unknown>) => ({ name: 'TrancheRefunded', position: 0, blockNumber: 1n, logIndex: 0n, txHash: '0x00', args }) as unknown as DealEvent

test('a refund line states the prepaid fee it includes, matching the deal page total', () => {
  expect(describeEvent(ev({ amount: '15000000', feeRefunded: '75000' }))).toBe('Part 1 returned to the buyer: 15.075 USDC (15.00 part + 0.075 prepaid fee)')
  expect(describeEvent(ev({ amount: '15000000', feeRefunded: '0' }))).toBe('Part 1 returned to the buyer: 15.00 USDC')
})
