import { Children, type ReactNode } from 'react'
import { explorerBase } from '@/integration/network'

/**
 * A link to the block explorer, or the same text without a link when this network has none (a local fork).
 * Without an explorer the arrow is dropped and a tooltip says why, so nothing points at a dead page.
 */
export function ExplorerLink({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  if (explorerBase() === '') {
    const text = Children.toArray(children).map((c) => (typeof c === 'string' ? c.replace(/\s*↗\s*$/, '') : c))
    return <span className={className?.replace(/\bunderline\b/, '').trim()} title="No block explorer on this network">{text}</span>
  }
  return <a className={className} href={href} target="_blank" rel="noreferrer">{children}</a>
}
