import type { Address } from 'viem'

/** The four places a wallet can work from. The escrow's panel members work from the arbiter shell. */
export const SHELLS = ['buyer', 'supplier', 'attestor', 'arbiter'] as const
export type Shell = (typeof SHELLS)[number]

const ROLE_SHELL: Record<string, Shell> = {
  buyer: 'buyer',
  supplier: 'supplier',
  attestor: 'attestor',
  arbiter: 'arbiter',
  panel: 'arbiter',
}

export const shellLabel: Record<Shell, string> = {
  buyer: 'Buyer',
  supplier: 'Supplier',
  attestor: 'Attestor',
  arbiter: 'Arbiter',
}

export function isShell(value: string): value is Shell {
  return (SHELLS as readonly string[]).includes(value)
}

export interface WalletDealRole {
  role: 'buyer' | 'supplier' | 'attestor' | 'arbiter' | 'panel'
  /** The part an attestor confirms; null for whole-deal roles */
  part: number | null
}

/** One deal that names the wallet, as the relayer indexed it. */
export interface WalletDeal {
  dealId: bigint
  /** The indexed state word, or null before the index has one */
  state: string | null
  roles: WalletDealRole[]
}

/** Validates the relayer's answer. Throws on anything it does not understand rather than guessing. */
export function parseWalletDeals(raw: unknown): WalletDeal[] {
  if (!Array.isArray(raw)) throw new Error('Wallet deals are not a list')
  return raw.map((item): WalletDeal => {
    if (!item || typeof item !== 'object') throw new Error('Wallet deal is not an object')
    const r = item as Record<string, unknown>
    if (typeof r.dealId !== 'string' || !/^\d+$/.test(r.dealId)) throw new Error('Wallet deal has an invalid id')
    if (r.state !== null && typeof r.state !== 'string') throw new Error('Wallet deal has an invalid state')
    if (!Array.isArray(r.roles) || r.roles.length === 0) throw new Error('Wallet deal names no role')
    const roles = r.roles.map((entry): WalletDealRole => {
      if (!entry || typeof entry !== 'object') throw new Error('Wallet deal role is not an object')
      const e = entry as Record<string, unknown>
      if (typeof e.role !== 'string' || !(e.role in ROLE_SHELL)) throw new Error('Wallet deal has an unknown role')
      if (e.milestoneIndex !== null && !(Number.isInteger(e.milestoneIndex) && (e.milestoneIndex as number) >= 0)) {
        throw new Error('Wallet deal role has an invalid part')
      }
      return { role: e.role as WalletDealRole['role'], part: e.milestoneIndex as number | null }
    })
    return { dealId: BigInt(r.dealId), state: r.state as string | null, roles }
  })
}

/** Deals a wallet holds in one shell, order preserved (newest first from the relayer). */
export function dealsInShell(deals: readonly WalletDeal[], shell: Shell): WalletDeal[] {
  return deals.filter((d) => d.roles.some((r) => ROLE_SHELL[r.role] === shell))
}

/** Shells the wallet actually holds a role in, in the fixed order. */
export function heldShells(deals: readonly WalletDeal[]): Shell[] {
  return SHELLS.filter((s) => dealsInShell(deals, s).length > 0)
}

export function rolesIn(deal: WalletDeal, shell: Shell): WalletDealRole[] {
  return deal.roles.filter((r) => ROLE_SHELL[r.role] === shell)
}

export type { Address }
