'use client'

import { useState } from 'react'
import { useSignMessage } from 'wagmi'
import { encodeEscrowAction } from '@/integration/escrow'
import { describeUploadError, readFile, uploadEvidence, type EvidenceFile } from '@/integration/evidence'
import { sha256Hex } from '@/integration/evidence'
import { TxFlow } from '@/ui/TxFlow'
import { formatAmount } from '@/view/format'
import type { DealView, Tranche } from '@/view/types'
import type { Hex } from 'viem'

const MAX_FILES = 9
const MAX_BYTES = 10 * 1024 * 1024
const MIN_REASON = 10

type Stage = { kind: 'form' } | { kind: 'working'; text: string } | { kind: 'ready'; commitment: Hex }

/**
 * A buyer's dispute: the reason and files are stored first (one wallet signature covers the list), then the dispute
 * itself is sent with the digest of exactly those files. If storing fails, nothing is sent and the part stays unfrozen.
 */
export function DisputeDialog({ deal, part, owner, onCancel, onDone }: { deal: DealView; part: Tranche; owner: `0x${string}`; onCancel: () => void; onDone: () => void }) {
  const { signMessageAsync } = useSignMessage()
  const [reason, setReason] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [error, setError] = useState('')
  const [stage, setStage] = useState<Stage>({ kind: 'form' })

  const problem = (() => {
    if (reason.trim().length < MIN_REASON) return `Say what is wrong in at least ${MIN_REASON} characters.`
    if (files.length > MAX_FILES) return `Attach at most ${MAX_FILES} files.`
    if (files.some((f) => f.size < 1)) return 'One of the files is empty.'
    if (files.some((f) => f.size > MAX_BYTES)) return 'Each file must be 10 MB or smaller.'
    return ''
  })()

  const submit = async () => {
    if (problem) return setError(problem)
    setError('')
    try {
      setStage({ kind: 'working', text: 'Reading your files…' })
      const text = new TextEncoder().encode(reason.trim())
      const reasonFile: EvidenceFile = { name: 'reason.txt', mimeType: 'text/plain', bytes: text, sha256: await sha256Hex(text) }
      const all = [reasonFile, ...(await Promise.all(files.map(readFile)))]
      setStage({ kind: 'working', text: 'Approve the upload in your wallet. This signs a message and costs nothing.' })
      const commitment = await uploadEvidence({
        dealId: deal.id,
        part: part.position,
        signer: owner,
        files: all,
        sign: (message) => signMessageAsync({ message }),
      })
      setStage({ kind: 'ready', commitment })
    } catch (e) {
      setError(describeUploadError(e))
      setStage({ kind: 'form' })
    }
  }

  return (
    <>
      <p className="label">Part {part.index}</p>
      <h2 className="mt-1 text-[19px] leading-tight font-semibold">Dispute this part</h2>
      <p className="mt-2 text-[13.5px] leading-relaxed">
        {formatAmount(part.amount)} USDC stays frozen until the arbiter decides. Other parts are not affected. The supplier can respond, and you can withdraw the dispute before it is decided.
      </p>

      {stage.kind === 'ready' ? (
        <div className="mt-4">
          <p className="mb-3 rounded-md border border-released/40 bg-released-wash px-3 py-2 text-[13px]">
            Your reason and files are stored. Now send the dispute; its record is tied to exactly those files.
          </p>
          <TxFlow
            confirmLabel="Send dispute"
            tone="hold"
            steps={[{ label: 'Freeze this part and file the dispute', action: encodeEscrowAction({ kind: 'dispute', dealId: deal.id, milestoneIndex: part.position, evidenceHash: stage.commitment }) }]}
            onCancel={onCancel}
            onDone={() => onDone()}
          />
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          <div>
            <label className="label block" htmlFor="reason">What is wrong</label>
            <textarea
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={stage.kind === 'working'}
              rows={4}
              className="mt-1.5 w-full rounded-md border border-rule bg-sheet px-3 py-2.5 text-[14px] outline-none focus:border-held"
            />
          </div>
          <div>
            <label className="label block" htmlFor="files">Evidence files (optional)</label>
            <input
              id="files"
              type="file"
              multiple
              disabled={stage.kind === 'working'}
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
              className="mt-1.5 block w-full text-[13px]"
            />
            <p className="mt-1 text-[12px] text-graphite">Photos, documents or messages. Up to {MAX_FILES} files, 10 MB each. They are encrypted before they are stored, and only the people named in this deal can read them.</p>
          </div>
          {error ? <p role="alert" className="text-[13px] text-hold">{error}</p> : null}
          {stage.kind === 'working' ? <p role="status" className="text-[13px] text-graphite">{stage.text}</p> : null}
          <div className="flex gap-2">
            <button type="button" onClick={() => void submit()} disabled={stage.kind === 'working'} className="rounded-md bg-hold px-4 py-2 text-[13.5px] font-semibold text-sheet disabled:opacity-60">
              Store evidence and continue
            </button>
            <button type="button" onClick={onCancel} disabled={stage.kind === 'working'} className="rounded-md px-3 py-2 text-[13.5px] text-graphite hover:text-ink disabled:opacity-60">
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  )
}
