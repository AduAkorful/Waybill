import { useState, type FormEvent } from 'react'
import { parseUsdc } from '../onchain-money'
import { encodeVaultRegistryAction, type VaultRegistryAction } from '../integration/vaults-registry'
import { TransactionStatus } from './ProtocolActionButton'
import { useWaybillTransaction } from './use-waybill-transaction'

type AmountActionKind =
  | 'depositBond'
  | 'withdrawBond'
  | 'depositFinancing'
  | 'withdrawFinancing'

export function VaultAmountForm({ kind }: { kind: AmountActionKind }) {
  const transaction = useWaybillTransaction()
  const [amount, setAmount] = useState('')
  const [error, setError] = useState<string | null>(null)

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    try {
      const action = { kind, amount: parseUsdc(amount) } as VaultRegistryAction
      void transaction.execute(encodeVaultRegistryAction(action))
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError))
    }
  }

  return (
    <form onSubmit={submit}>
      <fieldset disabled={!transaction.ready}>
        <legend>{kind}</legend>
        <label>USDC amount <input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} required /></label>
        <button type="submit">Submit</button>
      </fieldset>
      {error && <p role="alert">{error}</p>}
      <TransactionStatus state={transaction.state} onReset={transaction.reset} />
    </form>
  )
}

export function FinancingLoanForm({
  kind,
  dealId,
}: {
  kind: 'borrow' | 'repay'
  dealId: bigint
}) {
  const transaction = useWaybillTransaction()
  const [amount, setAmount] = useState('')
  const [interestBps, setInterestBps] = useState('0')
  const [error, setError] = useState<string | null>(null)

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    try {
      const action = kind === 'borrow'
        ? { kind, dealId, amount: parseUsdc(amount), interestBps: Number(interestBps) }
        : { kind, dealId, amount: parseUsdc(amount) }
      void transaction.execute(encodeVaultRegistryAction(action))
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError))
    }
  }

  return (
    <form onSubmit={submit}>
      <fieldset disabled={!transaction.ready}>
        <legend>{kind} deal {dealId.toString()}</legend>
        <label>USDC amount <input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} required /></label>
        {kind === 'borrow' && (
          <label>Interest bps <input type="number" min="0" max="2000" value={interestBps} onChange={(event) => setInterestBps(event.target.value)} /></label>
        )}
        <button type="submit">Submit</button>
      </fieldset>
      {error && <p role="alert">{error}</p>}
      <TransactionStatus state={transaction.state} onReset={transaction.reset} />
    </form>
  )
}

export function AttestorProfileForm() {
  const transaction = useWaybillTransaction()
  const [name, setName] = useState('')
  const [city, setCity] = useState('')
  const [agentId, setAgentId] = useState('0')
  const [error, setError] = useState<string | null>(null)

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    try {
      void transaction.execute(encodeVaultRegistryAction({
        kind: 'setAttestorProfile',
        name,
        city,
        agentId: BigInt(agentId),
      }))
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError))
    }
  }

  return (
    <form onSubmit={submit}>
      <fieldset disabled={!transaction.ready}>
        <legend>Attestor profile</legend>
        <label>Name <input value={name} onChange={(event) => setName(event.target.value)} required /></label>
        <label>City <input value={city} onChange={(event) => setCity(event.target.value)} required /></label>
        <label>Agent id <input type="number" min="0" value={agentId} onChange={(event) => setAgentId(event.target.value)} /></label>
        <button type="submit">Save profile</button>
      </fieldset>
      {error && <p role="alert">{error}</p>}
      <TransactionStatus state={transaction.state} onReset={transaction.reset} />
    </form>
  )
}
