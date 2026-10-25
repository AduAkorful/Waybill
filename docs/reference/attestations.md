# Attestations

An attestation is an EIP-712 signature by a named attestor, saying that one part of one deal was done. The contract checks the signature; it does not judge what was signed.

## The signed data

Domain: name `WaybillEscrow`, version `1`, the chain id, and the escrow's address as the verifying contract.

```
Attestation(
  uint256 dealId,
  uint8   milestoneIndex,
  uint256 chainId,
  address verifyingContract,
  address signer,
  bytes32 statementVersion,
  bytes32 evidenceHash,
  uint64  signedAt,
  uint64  expiry
)
```

| Field | What it binds |
|---|---|
| `dealId`, `milestoneIndex` | Exactly one part of one deal. |
| `chainId`, `verifyingContract` | This chain and this escrow, so a signature cannot be replayed on another deployment or network. |
| `signer` | One named attestor. Two attestors signing for the same files get different digests, so one cannot be mistaken for the other. |
| `statementVersion` | `keccak256("waybill.v1")`. The fixed wording of the statement. |
| `evidenceHash` | A commitment to the files the attestor attached: the keccak256 of the files' SHA-256 digests, concatenated in order. Anyone with the same files in the same order can recompute it. |
| `signedAt`, `expiry` | When it was signed and when it stops being valid. The app uses a two-hour validity. |

The statement itself is templated text shown in the app, worded from the deal's own figures. What it says, and what it does not cover, appears next to the sign button.

## What `attest` checks

`attest(dealId, part, evidenceHash, signedAt, expiry, signer, signature)` reverts unless all of these hold:

1. The deal is `FUNDED`, the part exists and its condition is `ATTESTATION`.
2. The part is `WAITING`, or `OVERDUE` and still within its grace period.
3. `expiry` is in the future, and `signedAt` is not after `expiry`.
4. The digest has not been used before.
5. `signature` is valid for `signer`: ECDSA recovery for an ordinary wallet, or an ERC-1271 `isValidSignature` call for a smart-contract wallet.
6. `signer` is one of the part's named attestors, has already accepted the part, and has not already signed it.

Anyone may send the transaction. What matters is the signature, so an attestor can sign in a wallet and hand the signature to someone else to submit.

When the number of valid signatures reaches the part's threshold, the part moves to review (or straight to payable if its review window is 0). The last `evidenceHash` is stored on the part, and each signature emits `AttestationSubmitted` with its own hash.

## Replay and reuse

* A signature is single-use: its digest is recorded when accepted.
* It is bound to one deal, part, chain, contract and signer.
* It expires.

## Evidence files

Files are not sent to the contract. The app encrypts each one, stores it in object storage and on IPFS, and records only the commitment on chain. Uploading and reading files each need a short signed message from a party to the deal; see [API](api.md#evidence). The same commitment scheme is used for dispute reasons and responses.
