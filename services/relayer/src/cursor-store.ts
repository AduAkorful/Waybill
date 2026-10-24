import type { CursorStore, EventCursor } from './eligibility'

export interface SqlResult<Row> {
  rows: Row[]
}

export interface SqlExecutor {
  query<Row>(text: string, values?: readonly unknown[]): Promise<SqlResult<Row>>
}

interface CursorRow {
  block_number: string | number | bigint
  log_index: string | number | bigint
}

const READ_CURSOR_SQL = `
  SELECT block_number, log_index
  FROM waybill_relayer_cursors
  WHERE stream = $1
`

const WRITE_CURSOR_SQL = `
  INSERT INTO waybill_relayer_cursors (stream, block_number, log_index)
  VALUES ($1, $2, $3)
  ON CONFLICT (stream) DO UPDATE
    SET block_number = EXCLUDED.block_number,
        log_index = EXCLUDED.log_index,
        updated_at = NOW()
    WHERE waybill_relayer_cursors.block_number < EXCLUDED.block_number
       OR (
         waybill_relayer_cursors.block_number = EXCLUDED.block_number
         AND waybill_relayer_cursors.log_index <= EXCLUDED.log_index
       )
`

function toBigInt(value: string | number | bigint, field: string): bigint {
  try {
    const result = BigInt(value)
    if (result < 0n) throw new Error()
    return result
  } catch {
    throw new Error(`Invalid ${field} returned by cursor store`)
  }
}

export class PostgresCursorStore implements CursorStore {
  constructor(
    private readonly database: SqlExecutor,
    private readonly stream: string,
  ) {
    if (!stream.trim()) throw new Error('Cursor stream cannot be empty')
  }

  async get(): Promise<EventCursor | null> {
    const result = await this.database.query<CursorRow>(READ_CURSOR_SQL, [this.stream])
    const row = result.rows[0]
    if (!row) return null
    return {
      blockNumber: toBigInt(row.block_number, 'block_number'),
      logIndex: toBigInt(row.log_index, 'log_index'),
    }
  }

  async set(cursor: EventCursor): Promise<void> {
    const current = await this.get()
    if (
      current &&
      (cursor.blockNumber < current.blockNumber ||
        (cursor.blockNumber === current.blockNumber && cursor.logIndex < current.logIndex))
    ) {
      throw new Error('Event cursor cannot move backwards')
    }

    await this.database.query(WRITE_CURSOR_SQL, [
      this.stream,
      cursor.blockNumber.toString(),
      cursor.logIndex.toString(),
    ])
  }
}
