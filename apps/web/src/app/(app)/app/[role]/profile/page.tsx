'use client'

import { getReadClient } from '@/integration/read-client'
import { notFound, useParams } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { useAccount } from 'wagmi'
import { getBrowserChain, getBrowserNetwork } from '@/integration/network'
import { encodeVaultRegistryAction, readAttestorProfile } from '@/integration/vaults-registry'
import { Modal } from '@/ui/Modal'
import { TxFlow } from '@/ui/TxFlow'
import { shortAddress } from '@/view/format'

const input = 'mt-1.5 w-full rounded-md border border-rule bg-sheet px-3 py-2.5 text-[14px] focus:border-held'

/** The name and city shown beside an attestor's address in the public directory. Written to the registry by the attestor alone. */
export default function ProfilePage() {
  const { role } = useParams<{ role: string }>()
  if (role !== 'attestor') notFound()
  return <Profile />
}

function Profile() {
  const { address } = useAccount()
  const network = useMemo(() => getBrowserNetwork(), [])
  const client = useMemo(() => getReadClient(), [network])
  const [refresh, setRefresh] = useState(0)
  const [read, setRead] = useState<{ kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; name: string; city: string; agentId: bigint }>({ kind: 'loading' })
  const [name, setName] = useState('')
  const [city, setCity] = useState('')
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!address) return
    let cancelled = false
    readAttestorProfile(client, address, network)
      .then((p) => {
        const [n, c, agentId] = p as readonly [string, string, bigint]
        if (cancelled) return
        setRead({ kind: 'ready', name: n, city: c, agentId })
        setName(n)
        setCity(c)
      })
      .catch((e) => !cancelled && setRead({ kind: 'error', message: e instanceof Error ? e.message : String(e) }))
    return () => {
      cancelled = true
    }
  }, [client, network, address, refresh])

  const valid = name.trim() !== '' && city.trim() !== '' && name.length <= 256 && city.length <= 256
  return (
    <main className="max-w-xl px-4 pt-6 pb-16 md:px-8 md:pt-10">
      <p className="label">Attestor · <span className="mono normal-case">{address ? shortAddress(address) : ''}</span></p>
      <h1 className="mt-1 text-[28px] leading-tight font-semibold tracking-tight">Public profile</h1>
      <p className="mt-1 text-[13.5px] text-graphite">Shown in the attestor directory next to your record. Your counts of confirmed and disputed parts come from the registry and cannot be edited.</p>
      {read.kind === 'loading' ? <p role="status" className="mt-6 text-[14px] text-graphite">Reading your profile…</p> : null}
      {read.kind === 'error' ? <p role="alert" className="mt-6 text-[14px] text-hold">Your profile could not be read: {read.message}</p> : null}
      {read.kind === 'ready' ? (
        <div className="mt-6">
          <label className="label block" htmlFor="name">Name or company</label>
          <input id="name" className={input} value={name} onChange={(e) => setName(e.target.value)} />
          <label className="label mt-4 block" htmlFor="city">City</label>
          <input id="city" className={input} value={city} onChange={(e) => setCity(e.target.value)} />
          <button type="button" disabled={!valid || (name === read.name && city === read.city)} onClick={() => setOpen(true)} className="mt-5 rounded-md bg-held px-4 py-2.5 text-[14px] font-semibold text-sheet disabled:cursor-not-allowed disabled:opacity-40">
            Save profile
          </button>
          <Modal open={open} onClose={() => setOpen(false)} label="Save profile">
            {open ? (
              <>
                <h2 className="text-[19px] font-semibold">Save your public profile</h2>
                <p className="mt-2 mb-4 text-[13.5px] leading-relaxed">This is public and recorded on the registry. {name.trim()} · {city.trim()}</p>
                <TxFlow
                  confirmLabel="Save"
                  steps={[{ label: 'Write your profile to the registry', action: encodeVaultRegistryAction({ kind: 'setAttestorProfile', name: name.trim(), city: city.trim(), agentId: read.agentId }) }]}
                  onCancel={() => setOpen(false)}
                  onDone={() => { setOpen(false); setRefresh((n) => n + 1) }}
                />
              </>
            ) : null}
          </Modal>
        </div>
      ) : null}
    </main>
  )
}
