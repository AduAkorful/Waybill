'use client'

import { useState } from 'react'
import { useSignMessage } from 'wagmi'
import { describeUploadError, evidenceReader, type StoredEvidence } from '@/integration/evidence'
import { formatDateTime, shortAddress } from '@/view/format'

const kb = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`)

/**
 * The files stored for a deal, for the people named in it. Reading needs one wallet signature (nothing is spent);
 * the relayer checks that the signer is a party and returns the original bytes, never the stored ciphertext.
 */
export function EvidenceList({ dealId, owner, part }: { dealId: bigint; owner: `0x${string}`; part?: number }) {
  const { signMessageAsync } = useSignMessage()
  const [state, setState] = useState<{ kind: 'idle' } | { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; files: StoredEvidence[] }>({ kind: 'idle' })
  const [reader] = useState(() => evidenceReader({ dealId, signer: owner, sign: (message) => signMessageAsync({ message }) }))
  const [opening, setOpening] = useState<string | null>(null)
  const [openError, setOpenError] = useState('')

  const load = async () => {
    setState({ kind: 'loading' })
    try {
      setState({ kind: 'ready', files: await reader.list() })
    } catch (e) {
      setState({ kind: 'error', message: describeUploadError(e) })
    }
  }

  const open = async (file: StoredEvidence) => {
    setOpening(file.id)
    setOpenError('')
    try {
      const blob = await reader.download(file.id)
      const url = URL.createObjectURL(new Blob([blob], { type: file.mimeType }))
      const a = document.createElement('a')
      a.href = url
      a.download = file.fileName ?? 'evidence'
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch (e) {
      setOpenError(describeUploadError(e))
    } finally {
      setOpening(null)
    }
  }

  if (state.kind === 'idle' || state.kind === 'loading') {
    return (
      <div>
        <button type="button" onClick={() => void load()} disabled={state.kind === 'loading'} className="rounded-md border border-rule px-3 py-1.5 text-[13px] font-semibold disabled:opacity-60">
          {state.kind === 'loading' ? 'Waiting for your wallet…' : 'Show the files'}
        </button>
        <p className="mt-1.5 text-[12px] text-graphite">Your wallet signs a message to prove you are named in this deal. Nothing is spent.</p>
      </div>
    )
  }
  if (state.kind === 'error') {
    return (
      <p role="alert" className="text-[13px] text-hold">
        {state.message} <button type="button" onClick={() => void load()} className="underline">Try again</button>
      </p>
    )
  }
  const files = part === undefined ? state.files : state.files.filter((f) => f.part === part)
  return (
    <div>
      {files.length === 0 ? <p className="text-[13px] text-graphite">No files have been stored{part === undefined ? '' : ' for this part'} yet.</p> : null}
      <ul className="divide-y divide-rule rounded-md border border-rule bg-paper text-[13px]">
        {files.map((f) => (
          <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
            <div className="min-w-0">
              <p className="truncate font-semibold">{f.fileName ?? 'Unnamed file'}</p>
              <p className="text-[12px] text-graphite">
                Part {f.part + 1} · {kb(f.byteSize)} · {shortAddress(f.uploadedBy)}
                {f.uploadedAt ? ` · ${formatDateTime(BigInt(f.uploadedAt))}` : ''}
              </p>
            </div>
            <button type="button" onClick={() => void open(f)} disabled={opening === f.id} className="text-[12.5px] underline disabled:opacity-60">{opening === f.id ? 'Opening…' : 'Download'}</button>
          </li>
        ))}
      </ul>
      {openError ? <p role="alert" className="mt-2 text-[12.5px] text-hold">{openError}</p> : null}
    </div>
  )
}
