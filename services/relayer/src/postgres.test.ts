import { describe, expect, test } from 'bun:test'

import {
  applyMigrations,
  databaseSsl,
  secureTables,
  createPostgresPool,
  type Migration,
  type MigrationClient,
  type MigrationPool,
} from './postgres'

class FakeClient implements MigrationClient {
  readonly calls: { text: string; values?: readonly unknown[] }[] = []
  readonly applied = new Set<string>()
  failOn: string | undefined
  failRollback = false

  async query<Row>(text: string, values?: readonly unknown[]) {
    this.calls.push({ text, values })
    if (text === 'SELECT name FROM waybill_schema_migrations ORDER BY name') {
      return { rows: [...this.applied].map((name) => ({ name })) as Row[] }
    }
    if (text.startsWith('INSERT INTO waybill_schema_migrations')) {
      this.applied.add(String(values?.[0]))
      return { rows: [] as Row[] }
    }
    if (this.failOn && text === this.failOn) throw new Error('migration failed')
    if (text === 'ROLLBACK' && this.failRollback) throw new Error('rollback failed')
    return { rows: [] as Row[] }
  }

  release() {}
}

class FakePool implements MigrationPool {
  constructor(readonly client: FakeClient) {}
  async connect() {
    return this.client
  }
}

const migrations: Migration[] = [
  { name: '002_second.sql', sql: 'CREATE TABLE second (id INT)' },
  { name: '001_first.sql', sql: 'CREATE TABLE first (id INT)' },
]

describe('database TLS and table locking', () => {
  const CERT = '-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----'
  test('TLS is verified by default and can be switched off only explicitly, for a local database', () => {
    expect(databaseSsl({})).toEqual({ rejectUnauthorized: true })
    expect(databaseSsl({ WAYBILL_DATABASE_SSL: 'false' })).toBe(false)
  })
  test('a private certificate authority is trusted without turning verification off', () => {
    expect(databaseSsl({ WAYBILL_DATABASE_CA: CERT })).toEqual({ rejectUnauthorized: true, ca: CERT })
    // hosts often hand over PEM with literal \\n sequences
    expect(databaseSsl({ WAYBILL_DATABASE_CA: CERT.replace(/\n/g, '\\n') })).toEqual({ rejectUnauthorized: true, ca: CERT })
    expect(() => databaseSsl({ WAYBILL_DATABASE_CA: 'not a certificate' })).toThrow('PEM')
  })
  test('every waybill table is locked to its owner, and the statement names no table itself', async () => {
    const seen: string[] = []
    await secureTables({ query: async (text: string) => (seen.push(text), { rows: [] as never[] }) })
    expect(seen).toHaveLength(1)
    expect(seen[0]).toContain('ENABLE ROW LEVEL SECURITY')
    expect(seen[0]).toContain("tablename LIKE 'waybill\\_%'")
    expect(seen[0]).toContain('REVOKE ALL')
  })
})

describe('Postgres configuration and migrations', () => {
  test('requires an explicit database URL and bounds pool size', async () => {
    expect(() => createPostgresPool({} as NodeJS.ProcessEnv)).toThrow('DATABASE_URL')
    expect(() => createPostgresPool({
      WAYBILL_DATABASE_URL: 'postgres://example',
      WAYBILL_DATABASE_POOL_SIZE: '0',
    } as NodeJS.ProcessEnv)).toThrow('between 1 and 50')

    const pool = createPostgresPool({
      WAYBILL_DATABASE_URL: 'postgres://example',
      WAYBILL_DATABASE_POOL_SIZE: '4',
    } as NodeJS.ProcessEnv)
    expect(pool.options.max).toBe(4)
    expect(pool.options.ssl).toEqual({ rejectUnauthorized: true })
    await pool.end()
  })

  test('applies migrations in order and is idempotent', async () => {
    const client = new FakeClient()
    const pool = new FakePool(client)

    await expect(applyMigrations(pool, migrations)).resolves.toEqual([
      '001_first.sql',
      '002_second.sql',
    ])
    await expect(applyMigrations(pool, migrations)).resolves.toEqual([])
    expect(client.calls.some((call) => call.text === 'SELECT pg_advisory_xact_lock($1)')).toBe(true)
    expect(client.calls.find((call) => call.text === 'SELECT pg_advisory_xact_lock($1)')?.values).toEqual([
      7_298_481_901,
    ])
  })

  test('rolls back and releases when a migration fails', async () => {
    const client = new FakeClient()
    client.failOn = 'CREATE TABLE second (id INT)'

    await expect(applyMigrations(new FakePool(client), migrations)).rejects.toThrow(
      'migration failed',
    )
    expect(client.calls.map((call) => call.text)).toContain('ROLLBACK')
  })

  test('rejects duplicate or malformed migration names', async () => {
    await expect(applyMigrations(new FakePool(new FakeClient()), [
      { name: 'bad.sql', sql: 'SELECT 1' },
    ])).rejects.toThrow('numeric SQL format')
    await expect(applyMigrations(new FakePool(new FakeClient()), [
      { name: '001_same.sql', sql: 'SELECT 1' },
      { name: '001_same.sql', sql: 'SELECT 2' },
    ])).rejects.toThrow('unique')
  })
})
