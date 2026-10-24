import { describe, expect, test } from 'bun:test'
import { ContractFunctionExecutionError, ContractFunctionZeroDataError, toFunctionSelector } from 'viem'
import { ARC_TESTNET } from '@waybill/network/networks'
import { encodeArbiterListAction, encodeCapsAction, encodeOperatorAction, readPendingCaps } from './operator-actions'

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

describe('cap actions', () => {
  test('go to the escrow with the contract selectors and amounts', () => {
    const lower = encodeCapsAction({ kind: 'lowerCaps', maxDealAmount: 1_000_000_000n, maxLocked: 10_000_000_000n }, ARC_TESTNET)
    expect(lower.to).toBe(ARC_TESTNET.contracts.escrow)
    expect(lower.data.startsWith(toFunctionSelector('lowerCaps(uint256,uint256)'))).toBe(true)
    expect(lower.data.endsWith((10_000_000_000n).toString(16).padStart(64, '0'))).toBe(true)
    expect(encodeCapsAction({ kind: 'scheduleRaiseCaps', maxDealAmount: 2n, maxLocked: 3n }, ARC_TESTNET).data.startsWith(toFunctionSelector('scheduleRaiseCaps(uint256,uint256)'))).toBe(true)
    expect(encodeCapsAction({ kind: 'executeRaiseCaps' }, ARC_TESTNET).data).toBe(toFunctionSelector('executeRaiseCaps()'))
  })
  test('refuse zero caps and any other action', () => {
    expect(() => encodeCapsAction({ kind: 'lowerCaps', maxDealAmount: 0n, maxLocked: 1n }, ARC_TESTNET)).toThrow('above zero')
    expect(() => encodeCapsAction({ kind: 'setCaps' } as never, ARC_TESTNET)).toThrow('Unsupported')
  })
})

describe('readPendingCaps', () => {
  const client = (result: () => unknown) => ({ readContract: async () => result() }) as never
  test('a zero eta means nothing is scheduled', async () => {
    expect(await readPendingCaps(client(() => [0n, 0n, 0n]), ARC_TESTNET)).toBeNull()
  })
  test('returns the scheduled raise', async () => {
    expect(await readPendingCaps(client(() => [5n, 6n, 7n]), ARC_TESTNET)).toEqual({ maxDealAmount: 5n, maxLocked: 6n, eta: 7n })
  })
  test('an escrow without the function is reported as fixed caps, not as no raise', async () => {
    const zero = new ContractFunctionExecutionError(new ContractFunctionZeroDataError({ functionName: 'getPendingCaps' }), { abi: [], functionName: 'getPendingCaps' })
    expect(await readPendingCaps(client(() => { throw zero }), ARC_TESTNET)).toBe('unsupported')
  })
  test('a network failure is thrown, never read as no raise', async () => {
    await expect(readPendingCaps(client(() => { throw new Error('fetch failed') }), ARC_TESTNET)).rejects.toThrow('fetch failed')
  })
})
