# Security model

This page sets out what Waybill protects, how, and what you are trusting when you use it. Each control is written as the rule the contract enforces. For the plain-language version, see [How it works](../how-it-works.md#trust-and-security).

**Status.** The contracts have not had an independent audit. They were built with unit, fuzz, invariant and fork tests (see [Testing](#testing)), and early-access limits cap the exposure: 1,000 USDC per deal and 10,000 USDC held in total.

## Who can do what

| Actor | Can | Cannot |
|---|---|---|
| Anyone | Create a deal, send `claim`, `refund`, `applyDefault`, apply a delayed address change, retry a failed refund, submit someone else's signed attestation | Move money out of a deal except through its own rules |
| Buyer | Fund, approve a part, dispute, withdraw their own dispute, propose a new refund wallet | Take money back from a part that is paid, change the supplier or the arbiter, decide a dispute |
| Supplier | Accept, dispute an overdue part, respond to a dispute, propose a new payout wallet | Change the buyer's refund wallet, release a part without its condition |
| Attestor | Sign a statement for a part that names them | Sign for another attestor, or sign a part after its grace period |
| Arbiter | Decide a frozen part between supplier and buyer; flag an attestor's bond on that deal | Move money outside the frozen part, decide a part that is not disputed, or decide before decisions open |
| Operator (the pauser) | Stop new deals and funding; lower the limits at once; schedule limit raises, a treasury change, a fee-range change and arbiter-list changes (each takes effect after 48 hours); add or remove registry writers; schedule attestor status changes | Touch money in a deal, stop a claim, refund, dispute or decision, change a deal's terms, upgrade a contract |
| Relayer | Send `claim`, `refund` and `applyDefault` (which anyone can send); read the index and evidence | Send any other transaction, move money, sign for anyone |

## What the contract enforces

| Rule | How |
|---|---|
| Money leaves a deal only by that deal's rules | The escrow has no function that sends a deal's money to a caller-chosen address. Payments go to the supplier's payout wallet, the buyer's refund wallet, or, as fees, to the deal's recorded treasury, its attestors and its arbiter. |
| The supplier's payout wallet cannot be swapped under the buyer | Set once when the supplier accepts; changing it takes a proposal, a 48-hour delay and leaves the buyer a right to reject. The buyer's refund wallet has the mirror rule. |
| A part is paid at most once | Its state moves to `RELEASED`, `REFUNDED` or `RESOLVED` before any transfer, and a transfer that fails restores the state and the locked amount instead of marking the part paid. |
| An attestation is real, single-use and specific | See [Attestations](attestations.md): bound to one deal, part, chain, contract and signer; unexpired; digest recorded when used; signer must be a named attestor who accepted. |
| Nobody can be named without agreeing | The supplier, every attestor and the arbiter (or each panel member) must accept before the buyer can fund. If they do not accept by the deadline the deal is cancelled with nothing locked. |
| A blocked wallet cannot jam the deal | USDC transfers to the payout and refund wallets are non-reverting. A failure leaves the part payable, emits an event, and can be retried after the wallet is changed. Other parts are unaffected. |
| A pause stops only new deals | `pauseNewDeals` blocks `createDeal` and `fund`. It does not appear in any claim, refund, dispute, decision or withdrawal path. |
| Changing the rules cannot reach a deal that exists | Each deal records its own fee rate and the treasury at creation. A later fee-range, treasury or arbiter-list change affects only new deals. Lowering the limits never affects funded deals. |
| The limits are enforced where money enters | `createDeal` and `fund` both check the per-deal limit and the total held, including prepaid fees. |
| A registry or vault failure cannot block a payment | The escrow writes outcomes to the registry inside a guarded call; if it fails the payment still happens and `RegistryWriteFailed` is emitted. The bond and financing vaults hold only their own users' USDC and cannot call the escrow's payment functions. |
| An arbiter cannot be paid for not deciding | The arbiter fee goes to the arbiter only on a decision before the deadline. After the deadline anyone can apply the default and the fee returns to the buyer. |
| Slashing goes to the harmed party | A bond penalty goes only to the deal's refund or payout wallet, never to the operator, the treasury or the arbiter, and the arbiter can reverse it during a 72-hour appeal. |

## The operator key

The operator is one externally owned account. It is fixed in every contract at deployment, so moving to a multi-signature wallet means a new deployment. It is also the fee treasury. Pausing, lowering the limits, and adding or removing a registry writer take effect immediately. Every other change it can make waits 48 hours, visible on chain. The relayer raises an alert for each pauser action, so the team sees them as they happen.

If the key were stolen, an attacker could stop new deals, lower the limits, and schedule parameter changes that would sit visible for 48 hours before taking effect. They could not take or freeze money in a funded deal. The response would be to stop using the escrow for new deals and deploy a replacement; deals in flight keep working on the old contract.

## Arbiters

Arbiters are chosen by the operator through the delayed list. A buyer picks one, or a panel of three, when creating a deal, and sees the list. The three arbiters on the launch list are operated by the Waybill team, so at launch a panel of three does not add independence: two matching votes decide, and all three votes come from parties the team controls. Treat an arbiter's decision as a trust decision between you and whoever runs the arbiter, limited to the single frozen part.

## Privacy

* **Public and permanent:** everything on the blockchain, including wallet addresses, amounts, deadlines, the state of every part, and the commitments to evidence files.
* **Private to the parties:** details the buyer records about goods and people (unless made public), and evidence files. Both are served only to a wallet that signs a request and is named in the deal.
* **Who holds the keys:** evidence is encrypted (AES-256-GCM) before it is stored, but the relayer holds the encryption key, so the people who run the deployment can read the files. This is a trust assumption, not a cryptographic guarantee. The commitment on chain still proves what was submitted.
* **Email:** an address is stored only if the owner adds it, is used only for deal updates, and is mailed only after the owner confirms it from a link sent to it. The confirmation token is stored only as a hash.
* The Waybill database does not store passwords or private keys. Signing happens in the user's wallet.

## What you are trusting

* **The contracts' code**, which is open and verified at the addresses in [Contracts](contracts.md). There has been no outside review yet.
* **The website you are using.** A modified page could ask you to sign something else. Check the addresses in your wallet's prompt against [Contracts](contracts.md) before you sign.
* **Your wallet and sign-in provider.** Waybill uses Privy for email sign-in and wallet creation.
* **USDC.** The token's issuer can block addresses or pause the token. That is outside Waybill's control; a blocked recipient's money stays in the escrow until the address is changed.
* **Arc itself,** its validators and its public RPC.

## Known limits

* No independent audit, and no formal verification.
* One operator account; no multi-signature wallet.
* Contracts cannot be upgraded; a bug means a new deployment, and funded deals stay on the contract they were funded on.
* The launch arbiters are run by the team.
* Very small amounts (a few raw units of USDC) can fail to transfer on Arc's token and will stay payable until retried; use realistic amounts.
* The Chinese supplier text is a draft; the terms page is a draft.
* No security contact is published yet.

## Testing

* The contract suite is in `contracts/test` and runs with `forge test`. As of the mainnet deployment it had 339 tests that need no network, covering the deal lifecycle, every dispute path, fee modes, panels, address changes, timelocks, the registry and both vaults, plus fuzz tests and seven stateful invariant checks (run at 256 sequences of 500 calls). The invariants are: the escrow's token balance always covers the money it holds for open parts; money held is never overstated; every part ends in exactly one terminal fate; no terminal step ever reverts; a blocked refund stays owed until delivered; the vaults cannot reach the escrow's funds; and dispute decisions open and close at the right moments.
* A fork run exercised every flow, with 83 checks and no solvency failure.
* A live matrix on Arc testnet ran 279 labelled deals through the earlier deployment and reconciled every one to a terminal state with the escrow empty.
* The last change before launch, adjustable limits with a 48-hour delay on raises, was covered by unit, fuzz and invariant tests, but the live testnet matrix was not repeated for it.
