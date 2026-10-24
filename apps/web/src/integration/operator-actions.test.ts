import { describe, expect, test } from 'bun:test'
import { toFunctionSelector } from 'viem'
import { ARC_TESTNET } from '@waybill/network/networks'
import { encodeOperatorAction } from './operator-actions'

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
