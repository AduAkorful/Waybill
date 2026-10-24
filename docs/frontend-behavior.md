# Waybill frontend behavior contract

Status: behavior specification for the current frontend integration.  
Scope: current Arc deployment and current contract interfaces.  
This document defines behavior, not visual design. A screen or component may
look different, but it must not change these reads, checks, actions, or
outcomes.

## 1. Rules that every screen follows

### Network and custody

- The browser resolves exactly one network from the shared manifest:
  `VITE_WAYBILL_NETWORK=testnet` or a complete, independently supplied
  `mainnet` manifest.
- The selected chain must be Arc. The selected chain ID, USDC address, escrow
  address, vault addresses, registry address, and arbiter-list address must
  agree with the manifest.
- No UI may silently fall back from mainnet to testnet.
- Deal amounts are USDC raw units at the contract boundary: 6 decimals.
  Native Arc gas balances are separate 18-decimal values and are never used
  for deal arithmetic.
- The browser never receives or submits a private key. User actions are
  signed by the connected wallet through Privy/wagmi. The relayer has gas
  authority only for its fixed `claim`, `refund`, and `applyDefault` paths.
- The escrow is non-custodial. No frontend action may add an operator transfer,
  sweep, freeze, redirect, upgrade, or arbitrary-calldata path.

### Action lifecycle

Every write follows this sequence:

1. Read the selected network and wallet readiness.
2. Read the relevant live contract state and token balance/allowance.
3. Validate role, state, amount, timer, and address preconditions in the UI.
4. Show a confirmation that names the contract, action, amount, recipient,
   irreversibility, and network.
5. Encode one fixed operation against the manifest address.
6. Ask the active wallet to sign and broadcast.
7. Show `wallet_rejected` if signing is rejected.
8. Show `submitted` with the transaction hash immediately after broadcast.
9. Wait for one confirmation. Never call an action successful merely because a
   hash exists.
10. Show `confirmed` only for a successful receipt, or `reverted` for a
    reverted receipt.
11. Refresh live reads and the event/timeline view after confirmation.

If the receipt cannot be obtained after a transaction hash was saved, the UI
must show `unknown`/`needs verification`, retain the hash, stop automatic
resubmission, and refresh by hash or explorer. It must never tell the user to
blindly submit the same money action again.

### Read truth and degraded mode

- Live RPC reads are authoritative for contract state, balances, allowances,
  roles, and timers.
- The backend API is read-only and may provide history/projection context. A
  cached projection must be labelled stale when live reads are unavailable.
- `/health` is service health, `/v1/network` confirms the selected deployment,
  and `GET /v1/deals/:dealId` is a public read. Unknown routes and all API
  writes are rejected.
- A failed or incomplete read disables the affected action. The UI does not
  guess a balance, allowance, role, deadline, or state.
- Events are evidence for the timeline, notifications, and indexing, but an
  event signal never replaces a fresh state read before a write.

### User-visible transaction states

| State | Meaning | Required UI behavior |
| --- | --- | --- |
| `ready` | Wallet, chain, manifest, and required reads are valid | Enable only actions whose preconditions pass |
| `checking` | Reads or local validation are running | Disable duplicate submission and show what is being checked |
| `awaiting_signature` | Wallet prompt is open | Explain the action; do not claim it was submitted |
| `wallet_rejected` | User declined or wallet rejected | Preserve no false success; allow retry after fresh reads |
| `submitted` | Hash exists, receipt pending | Show hash and pending status; keep action idempotent |
| `confirmed` | One-confirmation successful receipt | Refresh state and show emitted events/effects |
| `reverted` | Receipt mined but transaction reverted | Show decoded error category; refresh state; do not claim a state change |
| `unknown` | Broadcast happened but receipt/status is unavailable | Preserve hash, block duplicate money actions, offer verification |
| `blocked` | Missing role, timer, allowance, balance, or required data | Explain the exact missing precondition and the next action |

## 2. Session and wallet flows

### App bootstrap

Reads:

- Browser network environment and validated manifest.
- Arc chain metadata and all current contract addresses.
- Privy public app ID and configured Arc chain.
- Optional backend `/health` and `/v1/network`.

Checks:

- Fail closed if the environment is missing, malformed, mismatched, or points
  to a legacy/unknown deployment.
- Do not render signing actions until the manifest and selected chain agree.
- A backend network response that differs from the browser manifest is a
  deployment error, not a reason to switch networks automatically.

Effects and emissions: none. This is read-only.

### Connect, login, logout, and active wallet

`Log in`/`Connect wallet`:

- Opens Privy authentication/wallet selection.
- Requires the user to choose or create a wallet; no server signer is used.
- After connection, read the address, chain ID, native gas balance, USDC
  balance, and current network.

`Switch to Arc`:

- Requests the configured Arc chain through the wallet.
- Does not submit a protocol transaction.
- Re-read chain ID after the wallet reports success. A failed switch leaves
  all writes blocked.

`Select wallet`:

- Changes only the active browser account.
- Re-read role-specific state and balances. Never reuse a previous account's
  eligibility or allowance.

`Log out`:

- Clears the active session and all account-specific cached reads.
- Does not interact with the chain.

### Wallet readiness

The action boundary is ready only when all applicable checks pass:

- authenticated/connected wallet exists;
- active account exists;
- wallet chain equals the selected Arc chain;
- manifest is valid;
- required live reads succeeded;
- the account has enough native gas;
- the account has enough USDC for the requested token action;
- allowance is sufficient when a vault or escrow funding action uses
  `transferFrom`.

Gas is estimated by the wallet/provider where possible and is not mixed with
USDC amounts. A low gas balance blocks or warns before signing; it does not
change the amount or recipient.

## 3. Deal creation and acceptance

### Deal builder validation

Before `Create deal`, read:

- allowed arbiter status and advertised fee from `ArbiterList`;
- current network and escrow addresses;
- buyer USDC balance only when `fundFirst` is selected;
- buyer address and all supplied role addresses;
- template/milestone fields from the form.

Validate:

- buyer is the connected wallet;
- supplier, refund address, arbiter, attestors, and optional panel members are
  valid distinct addresses where the protocol requires distinction;
- selected arbiter is currently allowed;
- one to eight milestones;
- milestone bps total exactly `10_000`;
- attestation milestones have named attestors and a threshold between one and
  the attestor count;
- non-attestation milestones have no attestors or threshold;
- dependencies use an earlier milestone or the independent sentinel;
- acceptance/deadline/review/grace values fit the contract integer bounds;
- fee payer is `BuyerPrepaid`, `SupplierDeducted`, or `Split`;
- arbiter fee and fee bps are in the currently allowed range;
- panel is empty for the named-arbiter path or contains exactly three distinct
  members for the panel path;
- no selected attestor is a buyer, supplier, arbiter, or forbidden panel
  member for that deal;
- all test/self-dealing deals are explicitly labelled offchain and excluded
  from reputation/volume claims.

The UI shows a final plain-language summary: parties, every tranche, who pays
fees, arbiter fee, deadlines, dispute default, evidence requirements, and the
fact that funded terms cannot change.

### `Create deal`

Wallet/signature: buyer signs a fixed `createDeal(...)` call to the current
escrow. This creates a proposed deal without moving USDC unless `fundFirst`
is true.

Preconditions:

- all builder validation passes;
- selected arbiter is allowed at the live read;
- new-deal pause is not active;
- buyer is the connected account.

Onchain effects:

- creates the deal and freezes its initial proposal data;
- records buyer, supplier, refund address, arbiter, amount, fee settings,
  deadlines, milestones, dependency data, and fee payer;
- emits `DealCreated`.

User effects:

- show the new deal ID and transaction hash;
- refresh the deal timeline;
- notify/invite supplier, attestors, and arbiter offchain;
- if not `fundFirst`, show acceptance progress and the next required action;
- if `fundFirst`, continue to the separate USDC approval/funding flow only
  after the receipt is confirmed.

Expected failures: `new deals paused`, invalid arbiter, invalid milestone
configuration, duplicate/invalid role, fee range error, or wallet rejection.

### `Create deal with panel`

This follows the same checks and result as `Create deal`, but calls fixed
`createDealWithPanel(...)` with exactly three panel members. The UI must explain
that the panel members accept and vote; it must not present the named-arbiter
decision path as interchangeable with a panel.

Expected event: `DealCreated`; later panel acceptance/vote events identify the
panel members.

### `Accept as supplier`

Reads:

- deal state and supplier address;
- connected wallet address;
- proposed payout address;
- acceptance deadline and current block time.

Wallet/signature: supplier signs `acceptSupplier(dealId, payoutAddress)`.

Effects:

- records supplier acceptance and the payout address;
- may make acceptance milestones eligible according to the deal rules;
- emits `SupplierAccepted`.

Success: refresh deal and milestone reads, show the next acceptance/funding
requirements, and do not imply that payment has happened.

Blocked/reverted cases: wrong supplier, wrong state, acceptance deadline,
invalid payout address, already accepted, or wallet rejection.

### `Accept as attestor`

Reads the milestone's named attestors, connected wallet, deal state, and
acceptance deadline.

Wallet/signature: signs `acceptAttestor(dealId, milestoneIndex)`.

Effects: records that this named attestor accepted the role and emits
`AttestorAccepted`. It does not submit evidence, sign an attestation, or move
funds.

### `Accept as arbiter`

Reads the deal arbiter/panel configuration, connected wallet, list eligibility,
and acceptance deadline.

Wallet/signature: the named-arbiter and panel acceptance paths use the
contract's fixed `acceptArbiter(dealId)` operation for the eligible caller;
there is no arbitrary panel-member calldata path.

Effects: records arbiter or panel-member acceptance and emits
`ArbiterAccepted` or `PanelMemberAccepted`. It does not resolve a dispute or
collect the fee.

### `Cancel before funding`

Wallet/signature: buyer signs `cancelUnaccepted(dealId)`.

Preconditions: deal is not funded and the acceptance path permits cancellation.

Effects: terminal cancellation, any refundable pre-funding state is settled,
and `DealCancelled` is emitted.

The UI removes all acceptance/funding actions after confirmation and shows
that the deal cannot be funded or edited. It must not offer cancellation as a
way to recover a funded deal.

## 4. Funding and token approvals

### `Approve USDC`

Before signing, read:

- USDC balance;
- current USDC allowance from the buyer to the escrow;
- exact required amount: principal plus applicable prepaid fee(s), including
  arbiter fee when buyer-prepaid.

Wallet/signature: buyer signs a fixed USDC `approve(escrow, amount)` call.

Effects: changes only the USDC allowance and emits the token's standard
approval event. It does not fund the deal and does not change escrow state.

The UI must state that approval is a token permission, show spender and amount,
and offer an exact-amount approval by default. A failed or rejected approval
leaves funding blocked.

### `Fund deal`

Reads immediately before signing:

- `getDeal`, `isFullyAccepted`, and all required acceptance flags;
- buyer address;
- USDC balance and allowance;
- exact funding amount and current pause state.

Wallet/signature: buyer signs fixed `fund(dealId)` to escrow.

Preconditions:

- standard flow: supplier, every named attestor, and arbiter/panel have
  accepted;
- optional fund-first flow: the configured protocol conditions allow funding
  before supplier acceptance;
- allowance and balance cover the exact amount;
- deal is not already funded/cancelled;
- new-deal pause does not incorrectly block this already-created deal if the
  contract permits funding under its current rules.

Effects:

- transfers USDC from buyer to escrow;
- locks terms and all parties/fees/milestones;
- changes deal to `Funded`;
- emits `DealFunded`.

Success: show amount locked, frozen terms, the next milestone/deadline, and
transaction hash. Never show supplier payment at funding.

Failures include `NotFullyAccepted`, insufficient allowance/balance, paused or
invalid state, expired acceptance, blocked token transfer, and wallet
rejection. On any failure, re-read balance, allowance, and deal state before
offering retry. Never double-charge because a previous hash is still unknown.

## 5. Milestone confirmation, attestation, review, and release

### Attestor evidence preparation

Before any wallet action:

- upload encrypted evidence through the offchain evidence adapter;
- require a non-empty file/pointer and compute the content digest;
- store object-store and IPFS references only after both stores succeed;
- show the exact `bytes32` evidence hash that will be anchored onchain;
- do not allow replacement of an existing onchain commitment.

If either storage write fails, delete the partial object-store write when
possible, show the failure, and do not ask the attestor to sign.

### `Sign attestation`

Reads:

- current deal/milestone and named attestor list;
- connected wallet address;
- selected Arc chain and current escrow address;
- statement version;
- evidence hash;
- current timestamp and chosen expiry;
- `usedAttestations(digest)` where the digest can be calculated.

Checks:

- the active wallet equals the named signer;
- milestone is eligible for attestation;
- evidence exists and hash matches;
- expiry is after signed time and within the intended window;
- digest has not already been used.

Wallet/signature: EIP-712 `WaybillEscrow / 1` typed data. The domain binds
chain ID and current escrow. The message binds deal ID, milestone, signer,
statement version, evidence hash, signed time, and expiry.

Effects: no onchain change yet. The signature is a user authorization artifact
that can be reviewed or discarded.

The UI must explicitly say that signing is not payment and that the signature
is single-use and bound to this deal, milestone, chain, and contract.

### `Submit attestation`

Wallet/signature: the submitting wallet sends fixed
`attest(dealId, milestoneIndex, evidenceHash, signedAt, expiry, signer,
signature)` to escrow. The current integration supports an explicit signer
field so digest collisions and replay across signers are not accepted.

Effects/events:

- verifies signature, signer, chain, contract, expiry, and single-use digest;
- records the attestation and evidence hash;
- emits `AttestationSubmitted`;
- when threshold is reached, emits `ThresholdMet` and
  `ReviewWindowStarted`/`MilestoneClaimable` according to the configured
  review window;
- later settlement records the attestor outcome and may emit a registry event
  off the escrow call.

Failures: wrong signer, expired signature, used digest, cross-deal/cross-chain
replay, not named, invalid state, missing acceptance, or wallet rejection.
Keep the signed artifact local/offchain for audit but never retry it blindly.

### `Approve milestone early`

Reads milestone state and review-window deadline. Only the buyer can do this
while the milestone is in review and not disputed.

Wallet/signature: `approveMilestone(dealId, milestoneIndex)`.

Effects: ends the buyer review window and makes the tranche claimable; emits
`MilestoneApprovedEarly` and the appropriate claimability event.

The UI must show the evidence and a clear irreversible warning. Approval is not
the payout itself; a separate claim may be sent by anyone or the relayer.

### `Claim tranche`

Reads fresh milestone state, deadline, review window, dispute flag, recipient
address, and the escrow collateral observation.

Wallet/signature:

- supplier, buyer, or any user may submit the fixed
  `claim(dealId, milestoneIndex)`;
- the relayer may submit only this fixed action after a fresh eligibility read.

Preconditions: release condition met, review window ended or buyer approved,
not disputed, not already terminal, and required dependency released.

Effects:

- marks the tranche released before attempting delivery;
- sends the tranche to the immutable supplier payout address;
- accrues protocol/attestor/arbiter fee accounting as configured;
- emits `TrancheClaimed`, or `PayoutFailed` if the token transfer is blocked;
- emits `DealSettled` when every tranche reaches a terminal fate.

Blocked payout handling: a failed recipient transfer must leave a retryable,
claimable liability; it must not silently report `Released` as delivered. The
UI shows `PayoutFailed`, recipient, amount, and the address-change/retry path.

## 6. Timeout, refund, and cascade flows

### `Apply overdue/default`

`applyDefault(dealId, milestoneIndex)` is a fixed, permissionless escrow action
used after the configured arbiter deadline. It is not an operator override.

Reads: dispute state, arbiter deadline, default direction, current time, and
whether the dispute is already resolved.

Effects: applies the pre-agreed default, moving the disputed tranche to its
resolved outcome and emitting `DefaultApplied`; emits the relevant refund,
claim, split, fee, and `DealSettled` events.

Before the deadline the button is blocked. The UI shows the exact deadline and
does not offer a manual early default.

### `Refund tranche`

Reads deadline, grace period, milestone state, dispute flag, buyer refund
address, and dependency state.

Wallet/signature: buyer or any permitted caller signs
`refund(dealId, milestoneIndex)`.

Preconditions: milestone is refundable after deadline plus grace, or the
acceptance deadline path allows cancellation/refund; no active dispute; no
released prerequisite violation.

Effects:

- marks the tranche refunded after successful delivery;
- returns principal and the applicable fee to buyer refund address;
- emits `TrancheRefunded`, or `RefundFailed` while retaining retryable
  liability;
- emits `DealSettled` when complete.

The UI must show principal and fee separately, the exact recipient, and that a
blocked recipient does not erase the liability.

### `Retry cascade refund`

Reads a pending cascade milestone, blocked recipient, current address, and
liability amount.

Wallet/signature: fixed `retryCascadeRefund(dealId, milestoneIndex)`.

Effects: retries delivery only for the pending refund, emits
`CascadeRefundRetried` on success, and then allows terminal settlement. A
failed retry remains pending and emits/retains the corresponding failure state.

### Timeout cascade

When the requested milestone times out, the contract may refund later
unreleased, non-disputed milestones according to the locked cascade rules.
The UI must list each affected tranche and distinguish:

- refunded successfully (`CascadeRefunded`);
- skipped because released or disputed;
- pending because the recipient transfer failed
  (`CascadeRefundPending`);
- still actionable by a later retry.

No UI code may assume that a cascade is all-or-nothing or that a receipt hash
means every individual transfer succeeded.

### `Cancel unaccepted`

For a fund-first deal that reaches its acceptance deadline without required
acceptance, the buyer uses `cancelUnaccepted(dealId)`. The UI shows the
fund-first warning and all pending acceptance roles. On success it refreshes
all tranche/refund liabilities and shows `DealCancelled`; it cannot be used
after ordinary settlement or to bypass a dispute.

## 7. Disputes and arbitration

### `Raise dispute`

Reads milestone state, role, review/grace timer, buyer/supplier identity,
evidence hash, and whether the tranche is already terminal.

Wallet/signature:

- buyer signs `dispute(dealId, milestoneIndex, evidenceHash)` during the review
  window;
- supplier uses the same fixed dispute path only during the permitted grace
  period after a missed deadline.

Effects:

- freezes only the selected tranche;
- records who raised it and the initial evidence commitment;
- emits `DisputeRaised`;
- starts response and arbiter timing as configured.

The UI must not freeze unrelated released or waiting tranches in its display.
It must require evidence and a reason offchain before enabling the button.

### `Respond to dispute`

Reads dispute status, connected role, response deadline, and existing response
hash. The other party signs fixed
`respondToDispute(dealId, milestoneIndex, evidenceHash)`.

Effects: records the response evidence and emits `DisputeResponseAdded`.
Outside the response window the action is blocked unless the contract's
append-only rule explicitly permits the relevant evidence action.

### `Append dispute evidence`

Reads dispute status, evidence window, submitter role, and evidence digest.
After redundant offchain storage succeeds, the party signs
`appendDisputeEvidence(dealId, milestoneIndex, evidenceHash)`.

Effects: appends without replacing prior evidence and emits
`DisputeEvidenceAppended` with its index. The UI shows append order and never
edits/deletes an onchain hash.

### `Withdraw buyer dispute`

Reads that the connected wallet is the buyer who raised the dispute, that the
milestone is still disputable, and that no terminal resolution has occurred.
The buyer signs `withdrawDispute(dealId, milestoneIndex)`.

Effects: withdraws the buyer-raised dispute, unfreezes the permitted flow, and
emits `DisputeWithdrawn`. The UI must show whether the milestone returns to
review/claimable or another protocol-defined state after refresh.

### `Resolve to supplier` / `Resolve to buyer`

Reads arbiter identity, open dispute, response/evidence status, and arbiter
deadline. The arbiter signs `resolve(dealId, milestoneIndex, toSupplier)`.

Effects:

- permanently resolves the frozen tranche to supplier or buyer;
- sends only to the locked supplier payout or buyer refund address;
- emits `DisputeResolved`;
- emits transfer/fee/settlement events;
- records attestor outcome where configured.

The UI must not allow an arbitrary recipient or amount and must require written
reasoning offchain before enabling the final decision.

### `Resolve split`

For a panel/fee-payer configuration that permits split resolution, the arbiter
signs `resolveSplit(dealId, milestoneIndex, supplierBps)`.

Validate `supplierBps` in `[0, 10_000]` and display the exact supplier and buyer
amounts after protocol fee backing. Effects emit `TrancheSplit` and the
resolution/settlement events. A split is final for that tranche.

### Panel vote

Reads panel membership, dispute state, prior vote, and valid vote encoding.
Each named panel member signs `castPanelVote(dealId, milestoneIndex, vote)`.

Effects:

- records one vote per eligible member;
- emits `PanelVoteCast`;
- once the panel threshold/majority is reached, emits `PanelResolved` and the
  corresponding release/refund outcome.

The UI must show anonymous/identified vote state according to the contract
record, prevent duplicate local submissions, and refresh after every receipt.

### Arbiter fee

The buyer-prepaid arbiter fee is separate from tranche principal:

- on funding, it is included in the buyer's required approval/funding amount;
- on an in-time arbiter decision, it is credited and later withdrawable by the
  arbiter (`ArbiterFeeCredited`);
- when the default outcome applies, it is refunded to the buyer
  (`ArbiterFeeRefunded`);
- a blocked refund is pending and retryable
  (`ArbiterFeeRefundPending`/`retryArbiterFeeRefund`);
- arbiter withdrawal uses `withdrawArbiterFee(dealId)` and emits the relevant
  withdrawal event.

The UI must never describe the arbiter fee as coming from escrowed principal.

## 8. Recipient address changes and blocked transfers

### `Propose payout address`

Reads current supplier payout address, connected supplier, proposed address,
and change delay. Supplier signs `proposePayout(dealId, newAddr)`.

Effects: records a delayed proposal and emits `PayoutChangeProposed`. It does
not immediately redirect existing funds.

### `Reject payout change`

The supplier signs `rejectPayoutChange(dealId)` when a pending proposal exists.
It emits `PayoutChangeRejected`; the old payout address remains active.

### `Apply payout change`

After the real onchain delay, the supplier signs
`applyPayoutChange(dealId)`. On success it emits `PayoutChangeApplied` and the
UI refreshes all pending payout/refund liabilities. The UI must show the
old/new address and delay before submission.

Refund address actions are the same shape for the buyer refund address:
`proposeRefundAddress`, `rejectRefundChange`, and `applyRefundChange`, with
`RefundChangeProposed`, `RefundChangeRejected`, and `RefundChangeApplied`.

No address-change action can rewrite a historical event, alter a resolved
tranche, or send funds to an address not selected by the protocol.

## 9. Financing vault flows

The financing vault holds lender funds only. It cannot read, freeze, or move
escrowed deal principal.

### `Approve financing vault`

Read USDC balance and allowance; buyer/lender signs fixed
`USDC.approve(financingVault, amount)`. This changes allowance only.

### `Deposit financing`

Read balance, allowance, and vault free liquidity/account state. Lender signs
`FinancingVault.deposit(amount)`.

Effects: moves USDC from lender to the vault, emits `LenderDeposited`, and
increases the lender's claimable balance/free liquidity.

### `Withdraw financing`

Read lender balance, principal, free liquidity, and wallet. Lender signs
`withdraw(amount)`.

Effects: withdraws only idle lender funds and emits `LenderWithdrawn`. It must
not be shown as a way to withdraw a deal's escrow principal.

### `Borrow`

Read live escrow deal state, connected supplier, total amount, active loan,
vault free liquidity, and interest cap.

Supplier signs `borrow(dealId, amount, interestBps)`.

Preconditions: supplier is the locked supplier, deal is `Funded` or `Settled`,
no active loan, amount is positive and no greater than the deal amount, vault
has liquidity, and interest is within the cap.

Effects: pays supplier from lender pool, records one active loan, emits
`Borrowed`, and leaves escrow balance/currentLocked unchanged.

### `Repay`

Read loan supplier, remaining amount, and payer balance. Anyone may sign
`repay(dealId, amount)`.

Effects: repayment is capped at the remaining debt, emits `Repaid`, and updates
loan/liquidity reads. The UI shows the actual remaining amount after receipt;
it must not imply that an overpayment was accepted.

## 10. Bond vault and registry flows

### Bond deposit/withdraw

Attestor reads USDC balance/allowance and free bond. `approveBond` is a fixed
USDC approval to the bond vault. `depositBond(amount)` signs
`BondVault.deposit(amount)` and emits `BondDeposited`. `withdrawBond(amount)`
signs `withdraw(amount)` and emits `BondWithdrawn`, limited to free bond.

These actions never call escrow and never affect deal principal.

### Flag negligent attestor

Arbiter reads disputed/resolved milestone, listed attestor, free bond, harmed
party, and slash bps. The arbiter signs
`flagNegligent(dealId, milestoneIndex, attestor, slashBps, harmed)`.

Validate harmed is exactly the buyer refund or supplier payout party, never the
operator, arbiter, attestor, or vault. Effects deduct free bond, create a
pending slash, return a slash ID, and emit `SlashFlagged`. No payment occurs
yet.

### Reverse or execute slash

Before the appeal ETA, the arbiter signs `reverseFlag(slashId)`. It restores
free bond and emits `SlashReversed`.

After the real ETA, anyone may sign `executeSlash(slashId)`. It transfers only
the locked bond amount to the recorded harmed party, records registry outcomes,
and emits `SlashExecuted`. The UI must show the timer and never forge or
shorten it.

### Attestor profile

Read current profile and active wallet. The attestor signs
`AttestorRegistry.setProfile(name, city, agentId)`.

Validate non-empty bounded name/city and a uint64 agent ID (`0` means no
external identity link). Effects emit `ProfileUpdated`; this action holds no
funds and cannot update another wallet's profile.

### Registry status and suspension

Status/counter/profile reads are public. Status changes and execution are
operator/pauser controls, not ordinary user UI:

- `scheduleSetStatus` emits `StatusScheduled`;
- `executeSetStatus` after the real 48-hour delay emits `StatusExecuted`;
- third/multiple-of-three upheld outcomes may emit
  `AutoSuspensionScheduled`;
- pauser cancellation emits `AutoSuspensionCancelled`.

The frontend only displays these states unless an explicitly authorized
operator surface is added. A suspended attestor must be blocked from new deal
assignment by the read/check path.

## 11. Operator and fee-recipient controls

These controls are deliberately not part of ordinary party UI and are not
arbitrary browser write capabilities. If an operator console is later added,
it must use a separately reviewed fixed-action boundary and an explicitly
authorized multi-party wallet.

### New-deal pause

The authorized pauser may call `pauseNewDeals()` or `unpauseNewDeals()`.
Reads show the current pause state. The UI must explain that pause blocks new
deal creation/funding only and does not block claims, refunds, disputes,
resolutions, defaults, retries, or fee withdrawals. Expected events are
`NewDealsPaused` and `NewDealsUnpaused`.

### Delayed protocol parameter controls

The authorized parameter wallet may schedule and later execute:

- `scheduleSetTreasury` / `executeSetTreasury`;
- `scheduleSetFeeBpsRange` / `executeSetFeeBpsRange`.

The UI must show proposed values and the real ETA, block execution before the
ETA, and show `SetTreasuryScheduled`, `SetTreasuryExecuted`,
`SetFeeBpsRangeScheduled`, or `SetFeeBpsRangeExecuted`. These changes apply to
new deals only and never rewrite an already-funded deal.

Arbiter add/remove scheduling belongs to `ArbiterList` and follows its
48-hour `schedule`/`execute` flow. It emits
`AddArbiterScheduled`/`AddArbiterExecuted` or
`RemoveArbiterScheduled`/`RemoveArbiterExecuted`. Do not offer a direct
arbiter mutation button; direct paths revert.

### Fee withdrawals

Protocol/attestor fee recipients read their own `feeBalance` and sign the
fixed `withdrawFees()` action. The arbiter uses the separate per-deal
`withdrawArbiterFee(dealId)` action described above. Both are pull withdrawals
to the caller's own account and emit `FeesWithdrawn` or the arbiter fee event.
Neither action can withdraw deal principal or another account's fees.

## 12. Read-only deal, public page, and backend behavior

### Deal reader

Required reads:

- `getDeal(dealId)`;
- `getMilestone(dealId, index)` for each milestone;
- acceptance/attestor/panel data where exposed;
- USDC balance/allowance for the connected account when an action is shown;
- current timestamp/deadlines;
- event history from the indexer/API.

The timeline renders the live state first, then event history and offchain
evidence pointers. It displays stale cached data explicitly and does not
derive terminal state solely from a missing event.

### Public API reader

Allowed browser calls:

- `GET /health`;
- `GET /v1/network`;
- `GET /v1/deals/:dealId`.

Responses serialize BigInt values as decimal strings. Non-2xx, malformed JSON,
wrong network, or unavailable live chain reads become typed read errors. The
client does not expose an API write method.

### Relayer-visible actions

The relayer watches only fixed escrow signal events:

- attestation/threshold and claimability signals;
- overdue/refundable signals;
- dispute/default timing signals as configured.

It re-reads current eligibility, reserves a durable logical attempt, submits
only `claim`, `refund`, or `applyDefault` to the configured escrow, persists
the hash, and waits for one confirmation. UI copy must call this sponsored
execution, not promise that the relayer is guaranteed or custodial.

## 13. Event and refresh contract

After every confirmed write, refresh:

1. transaction receipt and decoded events;
2. deal and affected milestone;
3. connected wallet USDC/native balances where relevant;
4. allowance where an approval/funding/vault action was involved;
5. vault loan/bond/profile/registry reads where relevant;
6. public API/indexer context;
7. notifications/outbox state through backend read surfaces when available.

Known event-to-refresh mapping:

| Event family | Refresh |
| --- | --- |
| `DealCreated`, `SupplierAccepted`, `AttestorAccepted`, `ArbiterAccepted`, `PanelMemberAccepted`, `DealFunded` | Deal, all acceptance flags, buyer allowance/balance, timeline |
| `AttestationSubmitted`, `ThresholdMet`, `ReviewWindowStarted`, `MilestoneApprovedEarly`, `MilestoneClaimable` | Milestone, evidence pointer, buyer review action |
| `TrancheClaimed`, `PayoutFailed`, `TrancheRefunded`, `RefundFailed`, `CascadeRefunded`, `CascadeRefundPending`, `CascadeRefundRetried` | Milestone, deal settlement, recipient liability, balances |
| `DisputeRaised`, `DisputeResponseAdded`, `DisputeEvidenceAppended`, `DisputeWithdrawn`, `DisputeResolved`, `TrancheSplit`, `DefaultApplied` | Dispute room, evidence list, timers, outcome, fees |
| `ArbiterFeeCredited`, `ArbiterFeeRefunded`, `ArbiterFeeRefundPending` | Arbiter fee status and retry/withdraw actions |
| `PayoutChange*`, `RefundChange*` | Current/pending recipient address and delayed-action timer |
| `Lender*`, `Borrowed`, `Repaid` | Vault balances, loan, USDC balance/allowance |
| `Bond*`, `Slash*` | Bond balance, slash record, appeal timer, registry counters |
| `ProfileUpdated`, `Status*`, `AutoSuspension*` | Profile, status, assignment eligibility |

Event decoding failure is an observable integration error. It must not turn a
confirmed transaction into a false state claim; retain the hash and refresh
the relevant live reads.

## 14. Acceptance checklist for visual UI work

The visual implementation is ready for review only when each screen:

- names the next action and its consequence;
- shows the relevant live state and exact deadline;
- disables actions on missing/unknown reads;
- explains wallet signature versus onchain confirmation;
- shows recipient and amount before any money-moving signature;
- preserves pending/reverted/unknown transaction states;
- links to the transaction hash/explorer after submission;
- does not expose arbitrary calldata, legacy addresses, admin fund paths, or
  testnet campaign wallets on mainnet;
- labels test/self-dealing deals and excludes them from reputation/volume;
- works without assuming the backend or relayer is available for a
  permissionless claim/refund/dispute action.

The components currently provide the integration primitives for wallet/network
readiness, deal reads, deal creation, attestation signing/submission, vault
and registry actions, and fixed transaction status. Visual pages still need
to compose the complete role-specific flows above without changing this
behavior contract.
