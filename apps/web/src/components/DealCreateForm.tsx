'use client'

import { useState, type FormEvent } from 'react'
import { parseUsdc } from '../onchain-money'
import type { Address } from '@waybill/network/networks'
import {
  encodeCurrentEscrowAction,
  type FeePayer,
  type MilestoneInput,
} from '../integration/current-actions'
import { getBrowserNetwork } from '../integration/network'
import { TransactionStatus } from './ProtocolActionButton'
import { useWaybillTransaction } from './use-waybill-transaction'

export interface DealCreateFormProps {
  milestoneInputs: MilestoneInput[]
  panel?: Address[]
}

export function DealCreateForm({ milestoneInputs, panel }: DealCreateFormProps) {
  const network = getBrowserNetwork()
  const transaction = useWaybillTransaction()
  const [supplier, setSupplier] = useState('')
  const [buyerRefund, setBuyerRefund] = useState('')
  const [arbiter, setArbiter] = useState('')
  const [totalAmount, setTotalAmount] = useState('')
  const [feeBps, setFeeBps] = useState('100')
  const [acceptanceDeadlineTs, setAcceptanceDeadlineTs] = useState('')
  const [arbiterDeadlineHours, setArbiterDeadlineHours] = useState('168')
  const [arbiterFee, setArbiterFee] = useState('0')
  const [fundFirst, setFundFirst] = useState(false)
  const [feePayer, setFeePayer] = useState<FeePayer>(0)
  const [error, setError] = useState<string | null>(null)

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    try {
      const action = panel
        ? {
            kind: 'createDealWithPanel' as const,
            panel,
            supplier: supplier as Address,
            buyerRefund: buyerRefund as Address,
            arbiter: arbiter as Address,
            totalAmount: parseUsdc(totalAmount),
            feeBps: Number(feeBps),
            acceptanceDeadlineTs: BigInt(acceptanceDeadlineTs),
            arbiterDeadlineHours: Number(arbiterDeadlineHours),
            milestoneInputs,
            fundFirst,
            arbiterFee: parseUsdc(arbiterFee),
            feePayer,
          }
        : {
            kind: 'createDeal' as const,
            supplier: supplier as Address,
            buyerRefund: buyerRefund as Address,
            arbiter: arbiter as Address,
            totalAmount: parseUsdc(totalAmount),
            feeBps: Number(feeBps),
            acceptanceDeadlineTs: BigInt(acceptanceDeadlineTs),
            arbiterDeadlineHours: Number(arbiterDeadlineHours),
            milestoneInputs,
            fundFirst,
            arbiterFee: parseUsdc(arbiterFee),
            feePayer,
          }
      void transaction.execute(encodeCurrentEscrowAction(action, network))
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError))
    }
  }

  return (
    <form onSubmit={submit}>
      <fieldset disabled={!transaction.ready || transaction.state.status === 'signing' || transaction.state.status === 'confirming'}>
        <legend>Create deal</legend>
        <label>Supplier <input value={supplier} onChange={(event) => setSupplier(event.target.value)} required /></label>
        <label>Buyer refund address <input value={buyerRefund} onChange={(event) => setBuyerRefund(event.target.value)} required /></label>
        <label>Arbiter <input value={arbiter} onChange={(event) => setArbiter(event.target.value)} required /></label>
        <label>Total USDC <input inputMode="decimal" value={totalAmount} onChange={(event) => setTotalAmount(event.target.value)} required /></label>
        <label>Fee bps <input type="number" min="0" value={feeBps} onChange={(event) => setFeeBps(event.target.value)} required /></label>
        <label>Acceptance deadline (Unix seconds) <input type="number" value={acceptanceDeadlineTs} onChange={(event) => setAcceptanceDeadlineTs(event.target.value)} required /></label>
        <label>Arbiter deadline (hours) <input type="number" min="1" value={arbiterDeadlineHours} onChange={(event) => setArbiterDeadlineHours(event.target.value)} required /></label>
        <label>Arbiter fee USDC <input inputMode="decimal" value={arbiterFee} onChange={(event) => setArbiterFee(event.target.value)} required /></label>
        <label>Fee payer
          <select value={feePayer} onChange={(event) => setFeePayer(Number(event.target.value) as FeePayer)}>
            <option value="0">Buyer prepaid</option>
            <option value="1">Supplier deducted</option>
            <option value="2">Split</option>
          </select>
        </label>
        <label><input type="checkbox" checked={fundFirst} onChange={(event) => setFundFirst(event.target.checked)} /> Fund first</label>
        <button type="submit">Create deal</button>
      </fieldset>
      <p>Milestones configured: {milestoneInputs.length}</p>
      {error && <p role="alert">{error}</p>}
      <TransactionStatus state={transaction.state} onReset={transaction.reset} />
    </form>
  )
}
