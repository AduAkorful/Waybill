import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Pool, type PoolConfig } from 'pg'

export interface SqlResult<Row> {
  rows: Row[]
}

export interface SqlExecutor {
  query<Row>(text: string, values?: readonly unknown[]): Promise<SqlResult<Row>>
}

export interface Migration {
  name: string
  sql: string
}

export interface MigrationClient extends SqlExecutor {
  release(): void
}

export interface MigrationPool {
  connect(): Promise<MigrationClient>
}

const MIGRATION_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS waybill_schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`

const ADVISORY_LOCK_SQL = 'SELECT pg_advisory_xact_lock($1)'
const MIGRATION_LOCK_KEY = 7_298_481_901

function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim()
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

function parsePoolSize(value: string | undefined): number {
  if (value === undefined) return 10
  if (!/^\d+$/.test(value)) throw new Error('WAYBILL_DATABASE_POOL_SIZE must be an integer')
  const size = Number(value)
  if (!Number.isSafeInteger(size) || size < 1 || size > 50) {
    throw new Error('WAYBILL_DATABASE_POOL_SIZE must be between 1 and 50')
  }
  return size
}

export function createPostgresPool(environment: NodeJS.ProcessEnv = process.env): Pool {
  const config: PoolConfig = {
    connectionString: required(environment, 'WAYBILL_DATABASE_URL'),
    max: parsePoolSize(environment.WAYBILL_DATABASE_POOL_SIZE),
    ssl: environment.WAYBILL_DATABASE_SSL === 'false' ? false : { rejectUnauthorized: true },
  }
  return new Pool(config)
}

export async function loadMigrations(directory: string): Promise<Migration[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const names = entries
    .filter((entry) => entry.isFile() && /^\d{3}_[a-z0-9_-]+\.sql$/.test(entry.name))
    .map((entry) => entry.name)
    .sort()
  return Promise.all(
    names.map(async (name) => ({
      name,
      sql: await readFile(join(directory, name), 'utf8'),
    })),
  )
}

export async function applyMigrations(
  pool: MigrationPool,
  migrations: readonly Migration[],
): Promise<string[]> {
  const sorted = [...migrations].sort((left, right) => left.name.localeCompare(right.name))
  if (
    sorted.some(
      (migration, index) =>
        !/^\d{3}_[a-z0-9_-]+\.sql$/.test(migration.name) ||
        (index > 0 && migration.name === sorted[index - 1]?.name),
    )
  ) {
    throw new Error('Migration names must be unique and use the numeric SQL format')
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(MIGRATION_TABLE_SQL)
    await client.query(ADVISORY_LOCK_SQL, [MIGRATION_LOCK_KEY])
    const applied = await client.query<{ name: string }>(
      'SELECT name FROM waybill_schema_migrations ORDER BY name',
    )
    const appliedNames = new Set(applied.rows.map((row) => row.name))
    const newlyApplied: string[] = []
    for (const migration of sorted) {
      if (appliedNames.has(migration.name)) continue
      if (!migration.sql.trim()) throw new Error(`Migration ${migration.name} is empty`)
      await client.query(migration.sql)
      await client.query(
        'INSERT INTO waybill_schema_migrations (name) VALUES ($1)',
        [migration.name],
      )
      newlyApplied.push(migration.name)
    }
    await client.query('COMMIT')
    return newlyApplied
  } catch (error) {
    try {
      await client.query('ROLLBACK')
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        'Migration failed and rollback also failed',
      )
    }
    throw error
  } finally {
    client.release()
  }
}
