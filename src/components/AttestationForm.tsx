import { useState, type FormEvent } from 'react'
import { useAccount, useWalletClient } from 'wagmi'
import type { Hex } from 'viem'
import type { Address } from '../../config/networks'
import {
  attestAction,
  signAttestation,
} from '../integration/attestation'
import { getBrowserNetwork } from '../integration/network'
import { TransactionStatus } from './ProtocolActionButton'
import { useWaybillTransaction } from './use-waybill-transaction'

export function AttestationForm({
  dealId,
  milestoneIndex,
}: {
  dealId: bigint
  milestoneIndex: number
}) {
  const { address, chainId } = useAccount()
  const { data: walletClient } = useWalletClient()
  const transaction = useWaybillTransaction()
  const [evidenceHash, setEvidenceHash] = useState('')
  const [expiry, setExpiry] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    if (!address || !walletClient) {
      setError('Connect the attestor wallet before signing.')
      return
    }
    try {
      const input = {
        dealId,
        milestoneIndex,
        evidenceHash: evidenceHash as Hex,
        signedAt: BigInt(Math.floor(Date.now() / 1000)),
        expiry: BigInt(expiry),
        signer: address as Address,
      }
      const network = getBrowserNetwork()
      if (chainId !== network.chainId) throw new Error('Switch the wallet to Arc before signing.')
      const signature = await signAttestation(walletClient, input, network)
      await transaction.execute(attestAction(input, signature, network))
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError))
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)}>
      <fieldset disabled={!transaction.ready || !address || !walletClient}>
        <legend>Sign attestation</legend>
        <p>Signer: {address ?? 'not connected'}</p>
        <label>Evidence hash <input value={evidenceHash} onChange={(event) => setEvidenceHash(event.target.value)} required /></label>
        <label>Expiry (Unix seconds) <input type="number" value={expiry} onChange={(event) => setExpiry(event.target.value)} required /></label>
        <button type="submit">Sign and submit attestation</button>
      </fieldset>
      {error && <p role="alert">{error}</p>}
      <TransactionStatus state={transaction.state} onReset={transaction.reset} />
    </form>
  )
}
