import { describe, expect, test } from 'bun:test'

import {
  PostgresAttemptStore,
  type RelayerAttemptKey,
} from './attempt-store'

type Row = {
  operation: string
  deal_id: string
  milestone_index: number
  status: 'pending' | 'submitted' | 'success' | 'reverted'
  tx_hash: `0x${string}` | null
  attempt_count: number
}

class FakeDatabase {
  readonly calls: { text: string; values: readonly unknown[] }[] = []
  private readonly rows = new Map<string, Row>()

  async query<RowType>(text: string, values: readonly unknown[] = []) {
    this.calls.push({ text, values })
    const [operation, dealId, milestoneIndex, fourth] = values
    const key = `${operation}:${dealId}:${milestoneIndex}`
    const row = this.rows.get(key)

    if (text.includes('INSERT')) {
      if (!row) {
        const created = {
          operation: String(operation),
          deal_id: String(dealId),
          milestone_index: Number(milestoneIndex),
          status: 'pending',
          tx_hash: null,
          attempt_count: 1,
        } as Row
        this.rows.set(key, created)
        return { rows: [created] as RowType[] }
      }
    } else if (text.includes('SET status = \'pending\'')) {
      if (row?.status === 'reverted') {
        row.status = 'pending'
        row.tx_hash = null
        row.attempt_count += 1
        return { rows: [row] as RowType[] }
      }
    } else if (text.includes('SET status = \'submitted\'')) {
      if (row?.status === 'pending') {
        row.status = 'submitted'
        row.tx_hash = fourth as `0x${string}`
      }
    } else if (text.includes('SET status = $4')) {
      if (row) row.status = fourth as Row['status']
    } else if (text.includes('SELECT')) {
      return { rows: (row ? [row] : []) as RowType[] }
    }
    return { rows: [] as RowType[] }
  }
}

const key: RelayerAttemptKey = {
  operation: 'claim',
  dealId: 8n,
  milestoneIndex: 1,
}
const txHash = `0x${'cd'.repeat(32)}` as `0x${string}`

describe('PostgresAttemptStore', () => {
  test('reads empty state and reserves a first attempt', async () => {
    const database = new FakeDatabase()
    const store = new PostgresAttemptStore(database)

    await expect(store.get(key)).resolves.toBeNull()
    await expect(store.reserve(key)).resolves.toEqual({
      attempt: { ...key, status: 'pending', txHash: null, attemptCount: 1 },
      shouldSubmit: true,
    })
    const insert = database.calls.find((call) => call.text.includes('INSERT'))
    expect(insert?.values).toEqual(['claim', '8', 1])
  })

  test('does not resubmit a submitted or successful logical action', async () => {
    const database = new FakeDatabase()
    const store = new PostgresAttemptStore(database)

    await store.reserve(key)
    await store.markSubmitted(key, txHash)
    await expect(store.reserve(key)).resolves.toMatchObject({
      shouldSubmit: false,
      attempt: { status: 'submitted', txHash, attemptCount: 1 },
    })
    await store.markReceipt(key, 'success')
    await expect(store.reserve(key)).resolves.toMatchObject({
      shouldSubmit: false,
      attempt: { status: 'success', attemptCount: 1 },
    })
  })

  test('does not let a duplicate pending reservation submit concurrently', async () => {
    const database = new FakeDatabase()
    const store = new PostgresAttemptStore(database)

    await expect(store.reserve(key)).resolves.toMatchObject({ shouldSubmit: true })
    await expect(store.reserve(key)).resolves.toMatchObject({
      shouldSubmit: false,
      attempt: { status: 'pending' },
    })
  })

  test('allows an explicit retry after a reverted receipt', async () => {
    const database = new FakeDatabase()
    const store = new PostgresAttemptStore(database)

    await store.reserve(key)
    await store.markSubmitted(key, txHash)
    await store.markReceipt(key, 'reverted')
    await expect(store.reserve(key)).resolves.toMatchObject({
      shouldSubmit: true,
      attempt: { status: 'pending', txHash: null, attemptCount: 2 },
    })
  })

  test('parameterizes keys and validates unsafe input', async () => {
    const database = new FakeDatabase()
    const store = new PostgresAttemptStore(database)

    await store.reserve({ ...key, dealId: 12345678901234567890n })
    expect(database.calls.every((call) => !call.text.includes('12345678901234567890'))).toBe(true)
    await expect(store.markSubmitted(key, '0x12')).rejects.toThrow('Invalid transaction hash')
    await expect(store.get({ ...key, milestoneIndex: 256 })).rejects.toThrow('between 0 and 255')
  })
})
