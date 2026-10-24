import { describe, expect, test } from 'bun:test'

import { PostgresCursorStore, type SqlExecutor } from './cursor-store'

class FakeSqlExecutor implements SqlExecutor {
  row: { block_number: string; log_index: string } | undefined
  calls: { text: string; values: readonly unknown[] }[] = []

  async query<Row>(text: string, values: readonly unknown[] = []): Promise<{ rows: Row[] }> {
    this.calls.push({ text, values })
    if (text.includes('SELECT')) {
      return { rows: this.row ? [this.row as Row] : [] }
    }
    this.row = {
      block_number: String(values[1]),
      log_index: String(values[2]),
    }
    return { rows: [] }
  }
}

describe('PostgresCursorStore', () => {
  test('reads an empty cursor and persists an event position', async () => {
    const database = new FakeSqlExecutor()
    const store = new PostgresCursorStore(database, 'escrow-events')

    expect(await store.get()).toBeNull()
    await store.set({ blockNumber: 12n, logIndex: 4n })
    expect(await store.get()).toEqual({ blockNumber: 12n, logIndex: 4n })
    const write = database.calls.find((call) => call.text.includes('INSERT'))
    expect(write?.values).toEqual(['escrow-events', '12', '4'])
  })

  test('allows idempotent writes and rejects backwards movement', async () => {
    const database = new FakeSqlExecutor()
    const store = new PostgresCursorStore(database, 'escrow-events')

    await store.set({ blockNumber: 12n, logIndex: 4n })
    await store.set({ blockNumber: 12n, logIndex: 4n })
    await expect(store.set({ blockNumber: 11n, logIndex: 99n })).rejects.toThrow(
      'cannot move backwards',
    )
  })

  test('keeps stream and cursor values out of SQL text', async () => {
    const database = new FakeSqlExecutor()
    const store = new PostgresCursorStore(database, 'stream-with-quote')

    await store.set({ blockNumber: 1n, logIndex: 2n })
    const write = database.calls.find((call) => call.text.includes('INSERT'))
    expect(write?.text).not.toContain('stream-with-quote')
    expect(write?.values).toEqual(['stream-with-quote', '1', '2'])
  })
})
