import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { COPY } from '../app/d/[id]/copy'

const dir = join(import.meta.dir, '..', 'app', 'd', '[id]')

describe('public deal page /d/[id]', () => {
  test('links into /app use a full load, not next/link (client transition stalled on mainnet)', () => {
    const src = readFileSync(join(dir, 'SupplierWallet.tsx'), 'utf8')
    expect(src).toContain('<a href={`/app/deals/${d.id}`}')
    expect(src).not.toMatch(/<Link[^>]*href=\{`\/app\//)
  })
  test('waiting for the wallet says so, in EN and ZH, instead of "Reading the deal"', () => {
    expect(COPY.en.walletLoading).not.toBe(COPY.en.loading)
    expect(COPY.zh.walletLoading.length).toBeGreaterThan(0)
    const src = readFileSync(join(dir, 'SupplierLink.tsx'), 'utf8')
    expect(src.match(/t\.loading/g)?.length).toBe(1)
  })
})
