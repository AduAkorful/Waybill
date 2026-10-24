import type { EncodedWalletAction } from '../integration/escrow'
import { useWaybillTransaction } from './use-waybill-transaction'

export interface ProtocolActionButtonProps {
  action: EncodedWalletAction
  label: string
  disabled?: boolean
}

export function ProtocolActionButton({
  action,
  label,
  disabled = false,
}: ProtocolActionButtonProps) {
  const transaction = useWaybillTransaction()
  const busy =
    transaction.state.status === 'signing' ||
    transaction.state.status === 'confirming'

  async function submit() {
    await transaction.execute(action)
  }

  return (
    <span>
      <button
        type="button"
        disabled={disabled || busy || !transaction.ready}
        onClick={() => void submit()}
      >
        {busy ? 'Processing…' : label}
      </button>
      <TransactionStatus state={transaction.state} onReset={transaction.reset} />
    </span>
  )
}

export function TransactionStatus({
  state,
  onReset,
}: {
  state: ReturnType<typeof useWaybillTransaction>['state']
  onReset?: () => void
}) {
  if (state.status === 'idle') return null
  if (state.status === 'signing') return <span role="status">Waiting for wallet signature.</span>
  if (state.status === 'confirming') {
    return <span role="status">Confirming transaction {state.hash}.</span>
  }
  if (state.status === 'success') {
    return <span role="status">Transaction confirmed: {state.hash}</span>
  }
  if (state.status === 'reverted') {
    return (
      <span role="alert">
        Transaction reverted: {state.hash}
        {onReset && <button type="button" onClick={onReset}>Dismiss</button>}
      </span>
    )
  }
  if (state.status === 'unknown') {
    return (
      <span role="alert">
        Transaction status is unknown: {state.hash}. Check the explorer before retrying.
      </span>
    )
  }
  if (state.status !== 'error') return null
  return (
    <span role="alert">
      {state.error.message}
      {onReset && <button type="button" onClick={onReset}>Dismiss</button>}
    </span>
  )
}
