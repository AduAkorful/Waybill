import { describe, expect, test } from 'bun:test'

import { ARC_TESTNET } from '@waybill/network/networks'
import { readAttestor, REGISTRY_EVENT_ABI } from './registry'

const who = `0x${'ab'.repeat(20)}` as `0x${string}`

function client(values: Record<string, unknown>) {
  return {
    readContract: async ({ functionName }: { functionName: string }) => {
      if (!(functionName in values)) throw new Error(`unexpected read ${functionName}`)
      return values[functionName]
    },
  } as never
}

const base = {
  status: 1,
  counts: [12, 1, 0],
  getProfile: ['Lin Mei Inspections', 'Ningbo', 0n],
  getPendingStatus: [0, 0n],
  isAutoSuspensionPending: false,
}

describe('attestor registry reads', () => {
  test('declares the registry events by their contract names', () => {
    expect(REGISTRY_EVENT_ABI.map((e) => e.name).sort()).toEqual([
      'AutoSuspensionCancelled',
      'AutoSuspensionScheduled',
      'OutcomeRecorded',
      'ProfileUpdated',
      'StatusExecuted',
      'StatusScheduled',
      'WriterAdded',
      'WriterRemoved',
    ])
  })

  test('maps the registry ledger, profile and no pending change', async () => {
    await expect(readAttestor(client(base), ARC_TESTNET, who)).resolves.toEqual({
      address: who,
      status: 'registered',
      attested: 12,
      upheld: 1,
      slashed: 0,
      profile: { name: 'Lin Mei Inspections', city: 'Ningbo', agentId: 0n },
      pending: null,
    })
  })

  test('reports an unset profile as absent and a pending automatic suspension', async () => {
    const record = await readAttestor(
      client({ ...base, getProfile: ['', '', 0n], getPendingStatus: [2, 1_800_000_000n], isAutoSuspensionPending: true }),
      ARC_TESTNET,
      who,
    )
    expect(record.profile).toBeNull()
    expect(record.pending).toEqual({ status: 'suspended', eta: 1_800_000_000n, automatic: true })
  })

  test('fails on an unknown status or any failed read instead of returning part of a record', async () => {
    await expect(readAttestor(client({ ...base, status: 9 }), ARC_TESTNET, who)).rejects.toThrow('Unknown attestor status')
    await expect(readAttestor(client({ ...base, counts: undefined, status: 1 } as never), ARC_TESTNET, who)).rejects.toThrow()
  })
})
