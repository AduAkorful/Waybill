# Contracts

Waybill is five contracts on Arc. The escrow holds every deal's USDC; the others sit around it and cannot reach that money. None of them is upgradeable: there are no proxies, and a new version is a new deployment.

| Contract | What it does |
|---|---|
| `WaybillEscrow` | Holds deal funds, runs the deal and part state machines, verifies attestations, pays out and refunds, accrues fees. |
| `ArbiterList` | The approved arbiters for new deals, each with an advertised fee. Changes wait 48 hours. |
| `AttestorRegistry` | Counts what each attestor has signed, how often they were penalised, their status, and an optional public profile. Cannot call the escrow or hold tokens. |
| `BondVault` | Holds attestors' own USDC as a bond that an arbiter can penalise. Cannot touch deal money. |
| `FinancingVault` | Holds lenders' USDC and lends to suppliers against funded deals. Cannot touch deal money. |

The escrow is split across **six logic libraries** (`DealLogic`, `AttestLogic`, `ClaimLogic`, `DisputeLogic`, `AdminLogic`, `ViewLogic`) because its code would otherwise exceed the contract size limit. They are external libraries, linked when the escrow is deployed and called by `DELEGATECALL`, so they run against the escrow's own storage and hold no state of their own. Their addresses are fixed in the escrow's bytecode.

The code is Solidity `0.8.28` (EVM `cancun`, optimizer on, `via_ir`), built with Foundry, using OpenZeppelin v5. The escrow's runtime size is 18,423 bytes.

## Addresses

### Arc mainnet (chain 5042)

Deployed 2026-10-24 by the operator wallet `0x74B4134C8d527a8D8AE8cb9503ab2043bCfC0ffd`, which is also the pauser and the fee treasury. The app reads these from `packages/network/src/networks.ts`.

| Contract | Address | Deploy block |
|---|---|---|
| WaybillEscrow | `0x8a13ff4FbfBd67cE10e1Fd015bD4a8De3179C5ff` | 27,636,004 |
| ArbiterList | `0x02595bECED23EBA03386d440a92d5e91263789EF` | 27,635,986 |
| AttestorRegistry | `0x3eA4F80Bf510B599D3EFaf21d1739FE4ac159286` | 27,635,995 |
| BondVault | `0x49A74167569270d4F0b72DD7Ec90832D3B4538C4` | 27,636,008 |
| FinancingVault | `0xf58bB23Dd7787542F855d8C6632DA3c0eAD3bCa8` | 27,636,010 |
| AdminLogic | `0x2E7237846b34C5DF74C32880fF977d78Ae1cacf6` | linked library |
| ViewLogic | `0x91FAA44BE04e4817a9E54f413e1F31f3f5d5fAc3` | linked library |
| DisputeLogic | `0x9CAA94c67bA6fC08Ec881809dCB35b353eF468ae` | linked library |
| DealLogic | `0x64493e779B363B36B78fA49d5b94a9541B3E43E8` | linked library |
| ClaimLogic | `0xe57E41c572D2fB21deA80feACc9CA7EF6dC89Bb7` | linked library |
| AttestLogic | `0x10bC2549B56b8e6A211B227e01CbAd693bd74006` | linked library |

USDC is `0x3600000000000000000000000000000000000000` (the ERC-20 interface, 6 decimals). Multicall3 is `0xcA11bde05977b3631167028862bE2a173976CA11`.

Deployment settings: per-deal cap 1,000 USDC, total cap 10,000 USDC, fee range 50 to 100 basis points, and three launch arbiters on the list: `0x5EAf26805258F49620fDb1e6FD8Afd91D7a6460e`, `0xd173Cf98dD4d8932d596cC5A8C9a7F780D271EB3` and `0xD77cCd68CBdeC5e205A0CaA60035ae4734958BC1`. The escrow and the BondVault are registered as writers in the AttestorRegistry.

### Arc testnet (chain 5042002)

| Contract | Address |
|---|---|
| WaybillEscrow | `0x542601ad285c9845cBEd91c18af34fD06993f831` |
| ArbiterList | `0x9748a603B1E6503DDF2350D17d17ea98fE09c33c` |
| AttestorRegistry | `0x19Ea53a8B6C8D8Ed776e8004D88BEf4Ff19E6555` |
| BondVault | `0x6d2d6652A2b7AaB352E8EB2E24Fc1954c14142d5` |
| FinancingVault | `0xAB278803a95E87bBa82a3C8A26B91f02dFD5461F` |

Testnet runs the same code with higher caps (100,000 and 1,000,000 USDC) and is used for testing only.

### Verified source

All eleven mainnet contracts are verified on [Sourcify](https://sourcify.dev) with a match on both runtime and creation bytecode, and the Arc explorer shows them as verified. The match is not an "exact match" only because the build sets `bytecode_hash = "none"`, which leaves no metadata hash to compare. To check a deployment yourself, rebuild with the committed `contracts/foundry.toml` and compare, or run `forge verify-contract` against Sourcify.

## The escrow

### Who can call what

| Function | Caller |
|---|---|
| `createDeal`, `createDealWithPanel` | Anyone (they become the buyer) |
| `acceptSupplier(dealId, payoutAddress)` | The deal's supplier |
| `acceptAttestor(dealId, part)` | A named attestor of that part |
| `acceptArbiter(dealId)` | The arbiter, or each member of a panel |
| `fund(dealId)` | The buyer |
| `cancelUnaccepted(dealId)` | Anyone, after the acceptance deadline has passed without full acceptance |
| `attest(...)` | Anyone may send it; it is valid only with an attestor's own signature (see [Attestations](attestations.md)) |
| `approveMilestone(dealId, part)` | The buyer |
| `dispute(dealId, part, evidenceHash)` | The buyer (part in review) or the supplier (part overdue, within grace) |
| `respondToDispute`, `appendDisputeEvidence` | The buyer or supplier; a response only from the side that did not raise the dispute |
| `withdrawDispute` | The buyer, for a dispute they raised |
| `waiveRebuttal` | The side that raised the dispute |
| `resolve`, `resolveSplit` | The deal's single arbiter |
| `castPanelVote` | A member of the deal's panel |
| `applyDefault`, `claim`, `refund` | Anyone |
| `retryArbiterFeeRefund`, `retryCascadeRefund` | Anyone |
| `withdrawFees()` | Anyone with a balance; pays out their own balance |
| `withdrawArbiterFee(dealId)` | The deal's arbiter |
| `proposePayout` / `rejectPayoutChange` | The supplier / the buyer |
| `proposeRefundAddress` / `rejectRefundChange` | The buyer / the supplier |
| `applyPayoutChange`, `applyRefundChange` | Anyone, after the 48-hour delay |
| `pauseNewDeals`, `unpauseNewDeals`, `lowerCaps`, `scheduleRaiseCaps`, `executeRaiseCaps`, `scheduleSetTreasury`, `executeSetTreasury`, `scheduleSetFeeBpsRange`, `executeSetFeeBpsRange` | The pauser only |

Several overloads of `createDeal` exist for compatibility; `createDealWithPanel` is the full form and the one the app uses. `addArbiter` and `removeArbiter` on the escrow always revert: arbiters are managed in the `ArbiterList`.

### What `createDeal` checks

New deals are refused when: new deals are paused; the supplier, refund address or arbiter is the zero address; the arbiter is not on the list, or is the buyer or the supplier; the total is zero or above the per-deal cap; the fee is outside the current range; the acceptance deadline is not in the future; the arbiter window is zero hours; the number of parts is not 1 to 8; the shares do not add up to 10,000 basis points; a part's dependency is not an earlier part; an attestor is the zero address, the buyer, the supplier, the arbiter, a duplicate or suspended in the registry, or there are more than five of them; or the escrow's held total plus this deal's total, fee and arbiter fee would exceed the total cap.

### Events

Every state change emits an event, and the relayer indexes all of them. The ones that matter for monitoring:

* Deal flow: `DealCreated`, `SupplierAccepted`, `AttestorAccepted`, `ArbiterAccepted`, `DealFunded`, `DealSettled`, `DealCancelled`.
* Parts: `AttestationSubmitted`, `ThresholdMet`, `ReviewWindowStarted`, `MilestoneApprovedEarly`, `MilestoneClaimable`, `TrancheClaimed`, `TrancheRefunded`, `MilestoneRefundable`, `TrancheSplit`.
* Failures that need attention: `PayoutFailed`, `RefundFailed`, `CascadeRefundPending`, `ArbiterFeeRefundPending`, `RegistryWriteFailed`.
* Disputes: `DisputeRaised`, `DisputeResponseAdded`, `DecisionWindowSet`, `RebuttalWaived`, `DisputeEvidenceAppended`, `DisputeWithdrawn`, `DisputeResolved`, `DefaultApplied`, `PanelVoteCast`, `PanelResolved`.
* Address changes: `PayoutChangeProposed/Rejected/Applied` and the same three for the refund address.
* Operator actions: `NewDealsPaused`, `NewDealsUnpaused`, `CapsLowered`, `CapsRaiseScheduled`, `CapsRaised`, `SetTreasuryScheduled/Executed`, `SetFeeBpsRangeScheduled/Executed`.

The full ABI, with every custom error, is `contracts/src/interfaces/IWaybillEscrow.sol`.

## ArbiterList

Holds the arbiters a buyer may name. The pauser schedules an addition (with the arbiter's advertised fee) or a removal, and can execute it only after **48 hours**. Anyone can read `isAllowed(arbiter)`, `feeUsdc(arbiter)` and the pending changes. A removed arbiter stays on the deals that already name them.

## AttestorRegistry

Records, per attestor, how many deals they signed in that settled (`attested`), how many penalties against them were upheld (`upheld`), and how many were slashed. Only registered writers can record outcomes, and the writers are the escrow and the BondVault, added by the pauser at deployment. A registry failure can never block a payout: the escrow absorbs it and emits `RegistryWriteFailed`.

On every **third** upheld outcome the registry schedules the attestor's suspension, effective after 48 hours; the pauser can cancel an automatic suspension. The pauser can also schedule any status change, again with a 48-hour delay. A suspended attestor cannot be named on new deals. Attestors manage their own public profile.

## Bond vault

Attestors deposit USDC into their own bond and can withdraw what is not locked. On a deal that is funded or settled, the **arbiter of that deal** can flag a named attestor of a part that is disputed or decided, choosing a percentage (up to 100%) of the attestor's free bond and a **harmed party** that must be the deal's refund wallet or payout wallet (never the pauser, treasury, the attestor or the vault itself). The amount is locked immediately. After the **72-hour** appeal period, anyone can execute the penalty and the locked amount goes to the harmed party; before that, the arbiter can reverse the flag and release the bond. Each executed penalty records `Slashed` and `Upheld` in the registry.

## Financing vault

Lenders deposit USDC and earn the interest suppliers pay. The supplier of a **funded** deal can borrow up to that deal's total, at an interest rate they set of at most **20%** (simple interest on the loan, not per year), one loan per deal at a time, while the vault has free liquidity. Anyone can repay; principal is repaid before interest. The vault never receives or moves a deal's escrowed money, and nothing in the escrow repays a loan: the supplier repays from their own funds.
