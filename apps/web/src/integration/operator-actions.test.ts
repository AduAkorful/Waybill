import { describe, expect, test } from 'bun:test'
import { toFunctionSelector } from 'viem'
import { ARC_TESTNET } from '@waybill/network/networks'
import { encodeArbiterListAction, encodeOperatorAction } from './operator-actions'

describe('operator actions', () => {
  test('encode to the escrow with no arguments', () => {
    const pause = encodeOperatorAction('pauseNewDeals', ARC_TESTNET)
    expect(pause.to).toBe(ARC_TESTNET.contracts.escrow)
    expect(pause.data).toBe(toFunctionSelector('pauseNewDeals()'))
    expect(pause.chainId).toBe(ARC_TESTNET.chainId)
    expect(encodeOperatorAction('unpauseNewDeals', ARC_TESTNET).data).toBe(toFunctionSelector('unpauseNewDeals()'))
  })
  test('nothing else can be encoded', () => {
    expect(() => encodeOperatorAction('withdrawFees' as never, ARC_TESTNET)).toThrow('Unsupported')
  })
})

describe('approved-list actions', () => {
  const arb = '0x00000000000000000000000000000000000000a1' as const
  test('go to the arbiter list, not the escrow, with the contract selectors', () => {
    const add = encodeArbiterListAction({ kind: 'scheduleAddArbiter', arbiter: arb, fee: 1_000_000n }, ARC_TESTNET)
    expect(add.to).toBe(ARC_TESTNET.contracts.arbiterList)
    expect(add.data.startsWith(toFunctionSelector('scheduleAddArbiter(address,uint256)'))).toBe(true)
    for (const kind of ['executeAddArbiter', 'scheduleRemoveArbiter', 'executeRemoveArbiter'] as const) {
      expect(encodeArbiterListAction({ kind, arbiter: arb }, ARC_TESTNET).data.startsWith(toFunctionSelector(`${kind}(address)`))).toBe(true)
    }
  })
  test('refuse the zero address, a bad address, a negative fee and any other action', () => {
    expect(() => encodeArbiterListAction({ kind: 'executeAddArbiter', arbiter: `0x${'0'.repeat(40)}` }, ARC_TESTNET)).toThrow()
    expect(() => encodeArbiterListAction({ kind: 'executeAddArbiter', arbiter: '0x12' as never }, ARC_TESTNET)).toThrow()
    expect(() => encodeArbiterListAction({ kind: 'scheduleAddArbiter', arbiter: arb, fee: -1n }, ARC_TESTNET)).toThrow()
    expect(() => encodeArbiterListAction({ kind: 'addArbiter', arbiter: arb } as never, ARC_TESTNET)).toThrow()
  })
})
