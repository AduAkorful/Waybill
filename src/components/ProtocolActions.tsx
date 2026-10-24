import type { ReactNode } from 'react'
import {
  encodeEscrowAction,
  type EscrowAction,
} from '../integration/escrow'
import {
  encodeCurrentEscrowAction,
  type CurrentEscrowAction,
} from '../integration/current-actions'
import {
  encodeVaultRegistryAction,
  type VaultRegistryAction,
} from '../integration/vaults-registry'
import { ProtocolActionButton } from './ProtocolActionButton'

export function EscrowActionButton({
  action,
  label,
  disabled,
}: {
  action: EscrowAction | CurrentEscrowAction
  label: string
  disabled?: boolean
}) {
  const encoded =
    'kind' in action &&
    [
      'createDeal',
      'createDealWithPanel',
      'cancelUnaccepted',
      'attest',
      'respondToDispute',
      'appendDisputeEvidence',
      'withdrawDispute',
      'resolve',
      'resolveSplit',
      'castPanelVote',
      'retryCascadeRefund',
      'retryArbiterFeeRefund',
      'withdrawArbiterFee',
      'proposePayout',
      'rejectPayoutChange',
      'applyPayoutChange',
      'proposeRefundAddress',
      'rejectRefundChange',
      'applyRefundChange',
    ].includes(action.kind)
      ? encodeCurrentEscrowAction(action as CurrentEscrowAction)
      : encodeEscrowAction(action as EscrowAction)
  return <ProtocolActionButton action={encoded} label={label} disabled={disabled} />
}

export function VaultRegistryActionButton({
  action,
  label,
  disabled,
}: {
  action: VaultRegistryAction
  label: string
  disabled?: boolean
}) {
  return (
    <ProtocolActionButton
      action={encodeVaultRegistryAction(action)}
      label={label}
      disabled={disabled}
    />
  )
}

export function RoleActionPanel({
  title,
  actions,
}: {
  title: string
  actions: Array<{
    label: string
    action: EscrowAction | CurrentEscrowAction | VaultRegistryAction
    disabled?: boolean
  }>
}) {
  return (
    <section aria-labelledby={`${title}-actions`}>
      <h2 id={`${title}-actions`}>{title}</h2>
      {actions.map((entry) => (
        <div key={entry.label}>
          {'kind' in entry.action &&
          ['approveBond', 'approveFinancing', 'depositBond', 'withdrawBond', 'depositFinancing', 'withdrawFinancing', 'flagNegligent', 'reverseFlag', 'executeSlash', 'borrow', 'repay', 'setAttestorProfile'].includes(entry.action.kind) ? (
            <VaultRegistryActionButton
              action={entry.action as VaultRegistryAction}
              label={entry.label}
              disabled={entry.disabled}
            />
          ) : (
            <EscrowActionButton
              action={entry.action as EscrowAction | CurrentEscrowAction}
              label={entry.label}
              disabled={entry.disabled}
            />
          )}
        </div>
      ))}
    </section>
  )
}

export function ActionList({
  children,
}: {
  children: ReactNode
}) {
  return <div>{children}</div>
}
