'use client'

import { useState } from 'react'
import { useSignMessage } from 'wagmi'
import { encodeEscrowAction } from '@/integration/escrow'
import { describeUploadError, sha256Hex, uploadEvidence } from '@/integration/evidence'
import { TxFlow } from '@/ui/TxFlow'
import type { DealView, Tranche } from '@/view/types'

type Stage = 'form' | 'working' | 'ready'

/**
 * Accepting a role records only that you accept; it moves no money. A declared conflict of interest is stored with
 * the deal's other evidence first, so both sides can read it, and the acceptance is sent only after it is stored.
 */
export function AcceptPanel({ deal, part, owner, onDone }: { deal: DealView; part: Tranche; owner: `0x${string}`; onDone: () => void }) {
  const { signMessageAsync } = useSignMessage()
  const [read, setRead] = useState(false)
  const [conflict, setConflict] = useState<'none' | 'declare' | null>(null)
  const [declaration, setDeclaration] = useState('')
  const [stage, setStage] = useState<Stage>('form')
  const [error, setError] = useState('')
  const ready = read && (conflict === 'none' || (conflict === 'declare' && declaration.trim().length > 8))

  const proceed = async () => {
    setError('')
    if (conflict === 'declare') {
      setStage('working')
      try {
        const bytes = new TextEncoder().encode(`Declared by ${owner}:\n${declaration.trim()}`)
        await uploadEvidence({
          dealId: deal.id,
          part: part.position,
          signer: owner,
          files: [{ name: 'conflict-declaration.txt', mimeType: 'text/plain', bytes, sha256: await sha256Hex(bytes) }],
          sign: (message) => signMessageAsync({ message }),
        })
      } catch (e) {
        setError(describeUploadError(e))
        setStage('form')
        return
      }
    }
    setStage('ready')
  }

  return (
    <div className="rounded-md border border-rule bg-sheet p-4">
      <p className="text-[15px] font-semibold">Accept this role?</p>
      <label className="mt-3 flex items-start gap-2.5 text-[13.5px]">
        <input type="checkbox" checked={read} onChange={(e) => setRead(e.target.checked)} disabled={stage !== 'form'} className="mt-1 accent-[var(--held)]" />
        I&apos;ve read the exact statement and what it doesn&apos;t cover.
      </label>
      <fieldset className="mt-3" disabled={stage !== 'form'}>
        <legend className="label">Any financial relationship with the buyer or supplier?</legend>
        <label className="mt-1.5 flex items-center gap-2 text-[13.5px]">
          <input type="radio" name={`conflict-${part.index}`} checked={conflict === 'none'} onChange={() => setConflict('none')} className="accent-[var(--held)]" /> None
        </label>
        <label className="mt-1 flex items-center gap-2 text-[13.5px]">
          <input type="radio" name={`conflict-${part.index}`} checked={conflict === 'declare'} onChange={() => setConflict('declare')} className="accent-[var(--held)]" /> Yes, I&apos;ll declare it
        </label>
        {conflict === 'declare' ? (
          <textarea rows={2} value={declaration} onChange={(e) => setDeclaration(e.target.value)} aria-label="Declaration" placeholder="Stored with the deal; the buyer and supplier can read it." className="mt-2 w-full rounded-md border border-rule bg-paper p-2 text-[13px]" />
        ) : null}
      </fieldset>
      {error ? <p role="alert" className="mt-2 text-[12.5px] text-hold">{error}</p> : null}
      <div className="mt-4">
        {stage === 'ready' ? (
          <TxFlow
            confirmLabel="Accept role"
            steps={[{ label: 'Accept this role. Moves no money.', action: encodeEscrowAction({ kind: 'acceptAttestor', dealId: deal.id, milestoneIndex: part.position }) }]}
            onCancel={() => setStage('form')}
            onDone={() => onDone()}
          />
        ) : (
          <button type="button" disabled={!ready || stage === 'working'} onClick={() => void proceed()} className="w-full rounded-md bg-held py-2.5 text-[14px] font-semibold text-sheet disabled:cursor-not-allowed disabled:opacity-40">
            {stage === 'working' ? 'Waiting for your wallet…' : conflict === 'declare' ? 'Store declaration and continue' : 'Continue'}
          </button>
        )}
      </div>
    </div>
  )
}
