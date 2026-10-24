import { describe, expect, test } from 'bun:test'
import { decodeFunctionData } from 'viem'
import { ARC_TESTNET } from '../../config/networks'
import {
  WAYBILL_ESCROW_ABI,
  encodeEscrowAction,
  encodeUsdcApproval,
} from './escrow'

describe('fixed wallet action boundary', () => {
  test('encodes claim only for the current escrow', () => {
    const encoded = encodeEscrowAction(
      { kind: 'claim', dealId: 12n, milestoneIndex: 2 },
      ARC_TESTNET,
    )
    const decoded = decodeFunctionData({
      abi: WAYBILL_ESCROW_ABI,
      data: encoded.data,
    })

    expect(encoded.to).toBe(ARC_TESTNET.contracts.escrow)
    expect(encoded.chainId).toBe(ARC_TESTNET.chainId)
    expect(decoded.functionName).toBe('claim')
    expect(decoded.args).toEqual([12n, 2])
  })

  test('encodes approval only to the configured USDC and escrow spender', () => {
    const encoded = encodeUsdcApproval(1_000_000n, ARC_TESTNET)
    const decoded = decodeFunctionData({
      abi: [
        {
          type: 'function',
          name: 'approve',
          stateMutability: 'nonpayable',
          inputs: [
            { name: 'spender', type: 'address' },
            { name: 'amount', type: 'uint256' },
          ],
          outputs: [{ name: '', type: 'bool' }],
        },
      ],
      data: encoded.data,
    })

    expect(encoded.to).toBe(ARC_TESTNET.usdc.address)
    expect(decoded.args).toEqual([ARC_TESTNET.contracts.escrow, 1_000_000n])
  })

  test('rejects an invalid milestone index and negative approval', () => {
    expect(() =>
      encodeEscrowAction(
        { kind: 'refund', dealId: 1n, milestoneIndex: 256 },
        ARC_TESTNET,
      ),
    ).toThrow('Invalid milestone index')
    expect(() => encodeUsdcApproval(-1n, ARC_TESTNET)).toThrow(
      'cannot be negative',
    )
  })
})
