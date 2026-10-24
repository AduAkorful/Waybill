'use client'

import { useEffect, useState } from 'react'
import { usePublicClient } from 'wagmi'
import { formatUsdc } from '../onchain-money'
import { readDeal, readMilestone } from '../integration/escrow'
import { getBrowserNetwork } from '../integration/network'
import { createWaybillApiClient, loadBrowserApiBaseUrl } from '../integration/api'

function stringify(value: unknown): string {
  return JSON.stringify(value, (_, child) =>
    typeof child === 'bigint' ? child.toString() : child,
  )
}

export function NetworkReadiness() {
  const network = getBrowserNetwork()
  return (
    <section aria-labelledby="network-heading">
      <h2 id="network-heading">Network</h2>
      <p>{network.network} · chain {network.chainId}</p>
      <p>USDC: {network.usdc.address} ({network.usdc.decimals} decimals)</p>
      <p>Escrow: {network.contracts.escrow}</p>
    </section>
  )
}

export function DealReader({
  dealId,
  milestoneIndex,
}: {
  dealId: bigint
  milestoneIndex?: number
}) {
  const publicClient = usePublicClient()
  const [state, setState] = useState<
    | { status: 'idle' | 'loading' }
    | { status: 'ready'; deal: unknown; milestone?: unknown }
    | { status: 'error'; error: string }
  >({ status: 'idle' })

  useEffect(() => {
    let active = true
    if (!publicClient) return
    if (dealId < 0n) {
      setState({ status: 'error', error: 'Deal id cannot be negative' })
      return
    }
    setState({ status: 'loading' })
    void (async () => {
      try {
        const deal = await readDeal(publicClient, dealId)
        const milestone =
          milestoneIndex === undefined
            ? undefined
            : await readMilestone(publicClient, dealId, milestoneIndex)
        if (active) setState({ status: 'ready', deal, milestone })
      } catch (error) {
        if (active) {
          setState({
            status: 'error',
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }
    })()
    return () => {
      active = false
    }
  }, [dealId, milestoneIndex, publicClient])

  if (state.status === 'idle' || state.status === 'loading') {
    return <section aria-live="polite">Loading deal {dealId.toString()}…</section>
  }
  if (state.status === 'error') {
    return <section role="alert">Unable to read deal: {state.error}</section>
  }
  if (state.status !== 'ready') return null

  return (
    <section aria-labelledby="deal-heading">
      <h2 id="deal-heading">Deal {dealId.toString()}</h2>
      <pre>{stringify(state.deal)}</pre>
      {state.milestone !== undefined && <pre>{stringify(state.milestone)}</pre>}
      <small>
        Amounts are raw USDC units; format display values with {formatUsdc(0n)}.
      </small>
    </section>
  )
}

export function ApiDealReader({
  dealId,
  baseUrl,
}: {
  dealId: bigint
  baseUrl?: string
}) {
  const [state, setState] = useState<
    | { status: 'idle' | 'loading' }
    | { status: 'ready'; deal: unknown }
    | { status: 'error'; error: string }
  >({ status: 'idle' })

  useEffect(() => {
    let active = true
    if (dealId < 0n) {
      setState({ status: 'error', error: 'Deal id cannot be negative' })
      return
    }
    setState({ status: 'loading' })
    void (async () => {
      try {
        const client = createWaybillApiClient(
          baseUrl ?? loadBrowserApiBaseUrl(),
        )
        const deal = await client.getDeal(dealId)
        if (active) setState({ status: 'ready', deal })
      } catch (error) {
        if (active) {
          setState({
            status: 'error',
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }
    })()
    return () => {
      active = false
    }
  }, [baseUrl, dealId])

  if (state.status === 'idle' || state.status === 'loading') {
    return <section aria-live="polite">Loading API deal {dealId.toString()}…</section>
  }
  if (state.status === 'error') {
    return <section role="alert">Unable to read API deal: {state.error}</section>
  }
  if (state.status !== 'ready') return null
  return (
    <section aria-labelledby="api-deal-heading">
      <h2 id="api-deal-heading">API deal {dealId.toString()}</h2>
      <pre>{stringify(state.deal)}</pre>
    </section>
  )
}
