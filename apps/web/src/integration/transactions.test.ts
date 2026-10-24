import { describe, expect, test } from 'bun:test'
import { keccak256, toBytes, type Hex, type TransactionReceipt } from 'viem'
import { ARC_TESTNET } from '@waybill/network/networks'
import { encodeEscrowAction } from './escrow'
import {
  assertActionNetwork,
  classifyWalletError,
  waitForActionReceipt,
  WaybillWalletError,
} from './transactions'

const hash = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as Hex

function receipt(status: 'success' | 'reverted'): TransactionReceipt {
  return { status } as TransactionReceipt
}

describe('frontend transaction lifecycle boundary', () => {
  test('waits for exactly one confirmation and preserves successful hashes', async () => {
    let confirmations: number | undefined
    const result = await waitForActionReceipt(
      {
        waitForTransactionReceipt: async (options) => {
          confirmations = options.confirmations
          return receipt('success')
        },
      } as never,
      hash,
    )

    expect(confirmations).toBe(1)
    expect(result).toMatchObject({ status: 'success', hash })
  })

  test('does not turn a reverted receipt into success', async () => {
    const result = await waitForActionReceipt(
      {
        waitForTransactionReceipt: async () => receipt('reverted'),
      } as never,
      hash,
    )
    expect(result).toMatchObject({ status: 'reverted', hash })
  })

  test('retains a submitted hash when receipt polling fails', async () => {
    const error = new Error('RPC timeout')
    const result = await waitForActionReceipt(
      {
        waitForTransactionReceipt: async () => {
          throw error
        },
      } as never,
      hash,
    )
    expect(result).toMatchObject({ status: 'unknown', hash, error })
  })

  test('classifies wallet rejection and preserves the original error', () => {
    const original = Object.assign(new Error('User rejected the request'), { code: 4001 })
    const classified = classifyWalletError(original)
    expect(classified).toBeInstanceOf(WaybillWalletError)
    expect(classified.code).toBe('user_rejected')
    expect(classified.cause).toBe(original)
  })

  test('rejects a wallet chain mismatch before a send', () => {
    const action = encodeEscrowAction(
      { kind: 'claim', dealId: 1n, milestoneIndex: 0 },
      ARC_TESTNET,
    )
    expect(() => assertActionNetwork(action, 5042, ARC_TESTNET.chainId)).toThrow(
      'expected 5042002',
    )
  })

  test('a network failure is never reported as a wallet decline', () => {
    const http = Object.assign(new Error('HTTP request failed. Status: 429'), { name: 'HttpRequestError', status: 429 })
    const wrapped = Object.assign(new Error('Request failed. user denied'), { cause: http })
    expect(classifyWalletError(wrapped).code).toBe('rpc_error')
    expect(classifyWalletError(new Error('network rejected: user rejected')).code).not.toBe('user_rejected')
  })

  test('a decline is found anywhere in the cause chain', () => {
    const inner = Object.assign(new Error('x'), { code: 4001 })
    expect(classifyWalletError(Object.assign(new Error('outer'), { cause: inner })).code).toBe('user_rejected')
  })

  test('a contract revert is named in plain words', () => {
    const selector = keccak256(toBytes('AcceptanceNotExpired()')).slice(0, 10)
    const error = Object.assign(new Error('execution reverted'), { cause: { data: selector } })
    const classified = classifyWalletError(error)
    expect(classified.code).toBe('reverted')
    expect(classified.message).toContain('after its acceptance deadline')
  })
})
