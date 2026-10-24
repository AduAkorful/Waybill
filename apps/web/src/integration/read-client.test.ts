import { describe, expect, test } from 'bun:test'
import { noteConfirmedBlock, pinRequest } from './read-client'

describe('reads after a confirmed transaction', () => {
  test('latest reads are pinned to the confirmed block for a few seconds, then let go', () => {
    expect(pinRequest('eth_call', [{ to: '0x1' }, 'latest'], 0)).toEqual([{ to: '0x1' }, 'latest'])
    noteConfirmedBlock(255n, 1_000)
    expect(pinRequest('eth_call', [{ to: '0x1' }, 'latest'], 2_000)).toEqual([{ to: '0x1' }, '0xff'])
    expect(pinRequest('eth_getBlockByNumber', ['latest', false], 2_000)).toEqual(['0xff', false])
    expect(pinRequest('eth_call', [{ to: '0x1' }, '0x10'], 2_000)).toEqual([{ to: '0x1' }, '0x10'])
    expect(pinRequest('eth_blockNumber', [], 2_000)).toEqual([])
    expect(pinRequest('eth_call', [{ to: '0x1' }, 'latest'], 20_000)).toEqual([{ to: '0x1' }, 'latest'])
  })
})
