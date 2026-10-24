import { verifyMessage, type Address, type Hex } from 'viem'

/** How long a signed request stays valid, either side of the server clock. */
export const SIGNATURE_WINDOW_SECONDS = 600

export type EvidenceAction = 'upload' | 'read'

export interface EvidenceAuthContext {
  network: string
  chainId: number
  escrow: Address
  dealId: bigint
}

/**
 * The exact text a wallet signs to upload or read evidence. It binds the action, network, escrow, deal, part and
 * the list of file digests, so a signature cannot be replayed for another deal, part or file.
 */
export function evidenceMessage(
  context: EvidenceAuthContext,
  action: EvidenceAction,
  signedAt: number,
  part: number | null,
  files: readonly string[],
): string {
  return [
    'Waybill evidence',
    `action: ${action}`,
    `network: ${context.network}`,
    `chain: ${context.chainId}`,
    `escrow: ${context.escrow.toLowerCase()}`,
    `deal: ${context.dealId}`,
    `part: ${partLabel(part)}`,
    `files: ${files.map((f) => f.toLowerCase()).join(',')}`,
    `signed: ${signedAt}`,
  ].join('\n')
}

/** Human text is 1-based like the UI ("Part 1"); the index the API and contract use is kept beside it. */
export function partLabel(part: number | null): string {
  return part === null ? 'all' : `${part + 1} (index ${part})`
}

export interface SignedRequest {
  signer: string
  signature: string
  signedAt: number
}

/** Returns the verified signer, or throws. Does not decide whether the signer may act; that is the party check. */
export async function verifySignedRequest(
  context: EvidenceAuthContext,
  action: EvidenceAction,
  request: SignedRequest,
  part: number | null,
  files: readonly string[],
  nowSeconds: number,
): Promise<Address> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(request.signer)) throw new Error('invalid_signer')
  if (!/^0x[0-9a-fA-F]+$/.test(request.signature)) throw new Error('invalid_signature')
  if (!Number.isInteger(request.signedAt) || Math.abs(nowSeconds - request.signedAt) > SIGNATURE_WINDOW_SECONDS) {
    throw new Error('signature_expired')
  }
  const valid = await verifyMessage({
    address: request.signer as Address,
    message: evidenceMessage(context, action, request.signedAt, part, files),
    signature: request.signature as Hex,
  })
  if (!valid) throw new Error('signature_mismatch')
  return request.signer as Address
}
