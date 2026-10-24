'use client'

import { getReadClient } from '@/integration/read-client'
import { useEffect, useMemo, useState } from 'react'
import { isAddress, parseAbi, type PublicClient } from 'viem'
import { createWaybillApiClient, loadBrowserApiBaseUrl } from '@/integration/api'
import { getBrowserChain, getBrowserNetwork } from '@/integration/network'
import { parseArbiters, type Arbiter } from '@/view/arbiter'
import { parseAttestors } from '@/view/attestor'
import type { Attestor } from '@/view/attestor'
import type { ArbiterCheck, BuilderLimits } from '@/view/builder'

const ESCROW_LIMITS = parseAbi([
  'function minFeeBps() view returns (uint16)',
  'function maxFeeBps() view returns (uint16)',
  'function maxDealAmount() view returns (uint256)',
  'function maxLocked() view returns (uint256)',
  'function currentLocked() view returns (uint256)',
  'function newDealsPaused() view returns (bool)',
])
const ARBITER_LIST = parseAbi(['function isAllowed(address) view returns (bool)', 'function feeUsdc(address) view returns (uint256)'])

function useClient(): PublicClient {
  const network = useMemo(() => getBrowserNetwork(), [])
  return useMemo(() => getReadClient(), [network])
}

/** The limits read earlier in this visit, shown at once while a fresh read runs. Memory only. */
let lastLimits: BuilderLimits | undefined

export type Read<T> = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; value: T }

/** The escrow's own limits, read live. Nothing about fees or caps is written into the page. */
export function useBuilderLimits(): Read<BuilderLimits> {
  const client = useClient()
  const network = getBrowserNetwork()
  const [read, setRead] = useState<Read<BuilderLimits>>(() => (lastLimits ? { status: 'ready', value: lastLimits } : { status: 'loading' }))
  useEffect(() => {
    let cancelled = false
    const address = network.contracts.escrow
    const call = (functionName: (typeof ESCROW_LIMITS)[number]['name']) => client.readContract({ address, abi: ESCROW_LIMITS, functionName } as never)
    Promise.all(['minFeeBps', 'maxFeeBps', 'maxDealAmount', 'maxLocked', 'currentLocked', 'newDealsPaused'].map((n) => call(n as never)))
      .then(([minFeeBps, maxFeeBps, maxDealAmount, maxLocked, currentLocked, newDealsPaused]) => {
        if (!cancelled) {
          lastLimits = {
              minFeeBps: Number(minFeeBps),
              maxFeeBps: Number(maxFeeBps),
              maxDealAmount: maxDealAmount as bigint,
              maxLocked: maxLocked as bigint,
              currentLocked: currentLocked as bigint,
              newDealsPaused: newDealsPaused as boolean,
          }
          setRead({ status: 'ready', value: lastLimits })
        }
      })
      .catch((e) => !cancelled && setRead({ status: 'error', message: e instanceof Error ? e.message : String(e) }))
    return () => {
      cancelled = true
    }
  }, [client, network])
  return read
}

/** Whether an address is on the approved arbiter list, and the fee it advertises. Null until a full address is typed. */
export function useArbiterCheck(address: string): Read<ArbiterCheck> | null {
  const client = useClient()
  const network = getBrowserNetwork()
  const [read, setRead] = useState<Read<ArbiterCheck> | null>(null)
  const valid = isAddress(address.trim(), { strict: false })
  useEffect(() => {
    if (!valid) return setRead(null)
    let cancelled = false
    setRead({ status: 'loading' })
    const target = address.trim() as `0x${string}`
    Promise.all([
      client.readContract({ address: network.contracts.arbiterList, abi: ARBITER_LIST, functionName: 'isAllowed', args: [target] }),
      client.readContract({ address: network.contracts.arbiterList, abi: ARBITER_LIST, functionName: 'feeUsdc', args: [target] }),
    ])
      .then(([allowed, fee]) => !cancelled && setRead({ status: 'ready', value: { allowed, fee } }))
      .catch((e) => !cancelled && setRead({ status: 'error', message: e instanceof Error ? e.message : String(e) }))
    return () => {
      cancelled = true
    }
  }, [client, network, address, valid])
  return read
}

/** Attestors the registry has seen, for the picker. Empty with a reason when the API is not available. */
export function useAttestorChoices(): { attestors: Attestor[]; note: string | null } {
  const [state, setState] = useState<{ attestors: Attestor[]; note: string | null }>({ attestors: [], note: null })
  useEffect(() => {
    let cancelled = false
    try {
      createWaybillApiClient(loadBrowserApiBaseUrl())
        .getAttestors()
        .then((raw) => !cancelled && setState({ attestors: parseAttestors(raw).filter((a) => a.status !== 'suspended'), note: null }))
        .catch((e) => !cancelled && setState({ attestors: [], note: `The attestor directory is unavailable: ${e instanceof Error ? e.message : String(e)}` }))
    } catch {
      setState({ attestors: [], note: 'The attestor directory is not configured on this site.' })
    }
    return () => {
      cancelled = true
    }
  }, [])
  return state
}

/** Arbiters currently on the approved list, for the picker. Empty with a reason when the API is not available. */
export function useArbiterChoices(): { arbiters: Arbiter[]; note: string | null } {
  const [state, setState] = useState<{ arbiters: Arbiter[]; note: string | null }>({ arbiters: [], note: null })
  useEffect(() => {
    let cancelled = false
    try {
      createWaybillApiClient(loadBrowserApiBaseUrl())
        .getArbiters()
        .then((raw) => !cancelled && setState({ arbiters: parseArbiters(raw).filter((a) => a.allowed), note: null }))
        .catch((e) => !cancelled && setState({ arbiters: [], note: `The arbiter list is unavailable: ${e instanceof Error ? e.message : String(e)}` }))
    } catch {
      setState({ arbiters: [], note: 'The arbiter list is not configured on this site.' })
    }
    return () => {
      cancelled = true
    }
  }, [])
  return state
}
