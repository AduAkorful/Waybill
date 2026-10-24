'use client'

import { statementTime } from '@/view/attest-time'
import { useState } from 'react'
import { usePublicClient, useSignMessage, useWalletClient } from 'wagmi'
import type { Hex } from 'viem'
import { attestAction, signAttestation } from '@/integration/attestation'
import { describeUploadError, readFile, sha256Hex, uploadEvidence, type EvidenceFile } from '@/integration/evidence'
import { getBrowserNetwork } from '@/integration/network'
import { TxFlow } from '@/ui/TxFlow'
import type { DealView, Tranche } from '@/view/types'

const MAX_FILES = 9
const MAX_BYTES = 10 * 1024 * 1024
/** How long the signed statement stays valid for submission, in seconds. */
const VALID_FOR = 2 * 60 * 60

type Stage = { kind: 'form' } | { kind: 'working'; text: string } | { kind: 'ready'; input: Parameters<typeof attestAction>[0]; signature: Hex }

/**
 * Upload, then sign, then submit. The files are stored first; the digest of exactly those files is what the typed
 * statement commits to, so the buyer reviews what you signed. Nothing is sent to the chain until you approve it.
 */
export function WorkPanel({ deal, part, owner, onDone }: { deal: DealView; part: Tranche; owner: `0x${string}`; onDone: () => void }) {
  const { signMessageAsync } = useSignMessage()
  const { data: walletClient } = useWalletClient()
  const client = usePublicClient()
  const [files, setFiles] = useState<File[]>([])
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')
  const [stage, setStage] = useState<Stage>({ kind: 'form' })

  const problem = files.length < 1 ? 'Attach at least one file that shows what you confirm.' : files.length > MAX_FILES ? `Attach at most ${MAX_FILES} files.` : files.some((f) => f.size < 1 || f.size > MAX_BYTES) ? 'Each file must be between 1 byte and 10 MB.' : ''

  const submit = async () => {
    if (problem) return setError(problem)
    if (!walletClient) return setError('Your wallet is not ready. Try again in a moment.')
    setError('')
    try {
      setStage({ kind: 'working', text: 'Reading your files…' })
      const all: EvidenceFile[] = []
      if (notes.trim()) {
        const bytes = new TextEncoder().encode(notes.trim())
        all.push({ name: 'notes.txt', mimeType: 'text/plain', bytes, sha256: await sha256Hex(bytes) })
      }
      all.push(...(await Promise.all(files.map(readFile))))
      setStage({ kind: 'working', text: 'Step 1 of 2: approve the upload in your wallet. This signs a message and costs nothing.' })
      const evidenceHash = await uploadEvidence({ dealId: deal.id, part: part.position, signer: owner, files: all, sign: (message) => signMessageAsync({ message }) })
      setStage({ kind: 'working', text: 'Step 2 of 2: sign the statement in your wallet. This is not a payment.' })
      // the escrow checks expiry against block.timestamp, so stamp from the later of this device's clock and the
      // chain's: a device clock behind the chain (skew, or a forked chain moved forward) would sign an already-expired statement
      const signedAt = await statementTime(client)
      const input = { dealId: deal.id, milestoneIndex: part.position, evidenceHash, signedAt, expiry: signedAt + BigInt(VALID_FOR), signer: owner }
      const signature = await signAttestation(walletClient, input, getBrowserNetwork())
      setStage({ kind: 'ready', input, signature })
    } catch (e) {
      setError(describeUploadError(e))
      setStage({ kind: 'form' })
    }
  }

  if (stage.kind === 'ready') {
    return (
      <div className="rounded-md border border-rule bg-sheet p-4">
        <p className="mb-3 rounded-md border border-released/40 bg-released-wash px-3 py-2 text-[13px]">Your files are stored and the statement is signed. Send it to record your confirmation. It stays valid for two hours.</p>
        <TxFlow confirmLabel="Submit my confirmation" steps={[{ label: 'Record the signed statement', action: attestAction(stage.input, stage.signature, getBrowserNetwork()) }]} onCancel={() => setStage({ kind: 'form' })} onDone={() => onDone()} />
      </div>
    )
  }

  return (
    <div className="rounded-md border border-rule bg-sheet p-4">
      <p className="text-[15px] font-semibold">Upload your evidence and sign</p>
      <label className="label mt-3 block" htmlFor={`files-${part.index}`}>Files</label>
      <input id={`files-${part.index}`} name={`files-${part.index}`} aria-label={`Evidence files for part ${part.index}`} type="file" multiple disabled={stage.kind === 'working'} onChange={(e) => setFiles(Array.from(e.target.files ?? []))} className="mt-1.5 block w-full text-[13px]" />
      <p className="mt-1 text-[12px] text-graphite">Photos, inspection reports, documents. Up to {MAX_FILES} files, 10 MB each. They are encrypted before they are stored; only the people named in this deal can read them.</p>
      <label className="label mt-3 block" htmlFor={`notes-${part.index}`}>Notes (optional)</label>
      <textarea id={`notes-${part.index}`} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={stage.kind === 'working'} className="mt-1.5 w-full rounded-md border border-rule bg-paper p-2 text-[13px]" />
      {error ? <p role="alert" className="mt-2 text-[12.5px] text-hold">{error}</p> : null}
      {stage.kind === 'working' ? <p role="status" className="mt-2 text-[12.5px] text-graphite">{stage.text}</p> : null}
      <button type="button" onClick={() => void submit()} disabled={stage.kind === 'working'} className="mt-4 w-full rounded-md bg-held py-2.5 text-[14px] font-semibold text-sheet disabled:opacity-60">
        Upload and sign
      </button>
    </div>
  )
}
