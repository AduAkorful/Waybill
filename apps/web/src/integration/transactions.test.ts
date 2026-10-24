import { describe, expect, test } from 'bun:test'
import { keccak256, toBytes, type Hex, type TransactionReceipt } from 'viem'
import { ARC_TESTNET } from '@waybill/network/networks'
import { encodeEscrowAction } from './escrow'
import {
  assertCanPayFee,
  assertActionNetwork,
  classifyWalletError,
  plainError,
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

  test('a request limit relayed under a rejection code is still network trouble', () => {
    const relayed = Object.assign(new Error('Request exceeds defined limit'), { code: 4001 })
    expect(classifyWalletError(relayed).code).toBe('rpc_error')
    const limit = Object.assign(new Error('rate limit exceeded'), { code: -32005 })
    expect(classifyWalletError(limit).code).toBe('rpc_error')
  })

  test('an RPC that refuses the method is a setup fault, not a busy network', () => {
    const inner = Object.assign(new Error('Method not available on this endpoint'), { code: -32601 })
    const rpc = Object.assign(new Error('RPC Request failed.'), { name: 'RpcRequestError', code: -32601, cause: inner })
    const wrapped = Object.assign(new Error('Estimate gas failed'), { name: 'EstimateGasExecutionError', cause: rpc })
    const classified = classifyWalletError(wrapped)
    expect(classified.code).toBe('config')
    expect(classified.message).not.toMatch(/try again/i)
    expect(plainError(wrapped)).toMatch(/setup problem.*Nothing was sent\.$/)
    expect(classifyWalletError(Object.assign(new Error('x'), { name: 'MethodNotSupportedRpcError' })).code).toBe('config')
  })

  test('a revert relayed through the RPC proxy is named, never called a busy network', () => {
    // what viem builds from the proxy's {code: 3, message: 'execution reverted', data} for a create preflight
    const selector = keccak256(toBytes('InvalidAcceptanceDeadline()')).slice(0, 10)
    const inner = Object.assign(new Error('execution reverted'), { name: 'RpcRequestError', code: 3, data: selector })
    const wrapped = Object.assign(new Error('The contract function "createDeal" reverted'), { name: 'CallExecutionError', cause: inner })
    const classified = classifyWalletError(wrapped)
    expect(classified.code).toBe('reverted')
    expect(classified.message).toContain('acceptance deadline')
    expect(plainError(wrapped)).not.toMatch(/busy/i)
    const unknown = Object.assign(new Error('execution reverted'), { name: 'RpcRequestError', code: 3, data: '0xdeadbeef' })
    expect(classifyWalletError(unknown).message).toContain('0xdeadbeef')
  })

  test('plain wording for a declined signature never shows library text', () => {
    const raw = Object.assign(new Error('User rejected the request. Details: x Version: viem@2.57.7'), { code: 4001 })
    expect(plainError(raw)).toBe('You declined it in your wallet. Nothing was sent. You can try again.')
    expect(plainError(new Error('Details: boom Version: viem@2.57.7'))).toBe('The request failed. Nothing was sent.')
    expect(plainError(new Error('The evidence service is unavailable'))).toBe('The evidence service is unavailable')
  })
})

describe('assertCanPayFee', () => {
  test('a wallet holding less than the fee is told it has no USDC for the fee', () => {
    expect(() => assertCanPayFee(0n, 100_000n, 1_000_000_000n)).toThrow(/no USDC to pay the network fee/)
    expect(() => assertCanPayFee(99_999n * 1_000_000_000n, 100_000n, 1_000_000_000n)).toThrow(/no USDC/)
  })
  test('a wallet holding exactly the fee can send', () => {
    expect(() => assertCanPayFee(100_000n * 1_000_000_000n, 100_000n, 1_000_000_000n)).not.toThrow()
  })
})
