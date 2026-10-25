# How it works

A deal in Waybill is an escrow with parts. The buyer's USDC is split into up to eight parts, each with its own share of the total, its own condition for release and its own deadline. Each part is paid on its own, so a problem with one part does not freeze the rest.

## The people in a deal

* **Buyer.** Creates the deal and puts the money in.
* **Supplier.** Gets paid. The buyer names the supplier's wallet when the deal is created, and it cannot change afterwards. The supplier chooses the wallet that receives the payments when accepting.
* **Attestors.** People named per part, up to five, who sign a short statement that the part was done: an inspector, a forwarder, a surveyor. A part can need one signature or several (for example two of three).
* **Arbiter.** Decides disputed parts. The buyer picks one from the approved list when creating the deal, or picks a panel of three.

The arbiter cannot be the buyer or the supplier, and no attestor can be the buyer, the supplier or the arbiter.

## A deal from start to payout

1. **Create.** The buyer sets the parts, who confirms each one, the deadlines, the protocol fee and the arbiter. The contract checks all of it, including the size limits, and records the deal as proposed.
2. **Accept.** The supplier accepts with the wallet that should receive payments. Every attestor accepts the part they are named on. The arbiter, or each of the three panel members, accepts. Nothing is locked yet. If anyone has not accepted by the acceptance deadline, the deal can be cancelled and nothing was ever at risk.
3. **Fund.** Once everyone has accepted, the buyer locks the full amount in the escrow contract in one step: the total, the protocol fee (depending on who pays it) and the arbiter's fee.
4. **Confirm.** Each part is released by its own condition:
   * **Acceptance:** it starts its review window the moment the deal is funded.
   * **Attestation:** the named attestors sign. When enough have signed, the part starts its review window.
   * **Buyer approval:** the buyer approves it, which starts the review window.
   * **Timed:** nothing needs signing. Once its due date has passed, claiming it starts its review window.
5. **Review.** During a part's review window the buyer can approve it early or dispute it. A review window can be set to zero, which makes the part payable at once.
6. **Pay.** When the review window ends with no dispute, anyone can trigger the payment, and the supplier receives that part. Waybill's relayer does this automatically and pays the gas, but nothing depends on it: the supplier, the buyer or any other wallet can do it directly.
7. **Settle.** When every part is paid, refunded or decided, the deal is settled.

## When a part is not done

If an attestation or approval part is not confirmed by its due date, it becomes overdue. The supplier then has a grace period to still get it confirmed or to dispute it. If the grace period ends with neither, the part becomes refundable, and anyone can send its money back to the buyer. A refund also returns every later part that has not been paid, so the buyer is not left half-served. See [Disputes](disputes.md) for what happens when a part is contested.

## Trust and security

This is the plain-language summary. [Security model](reference/security.md) has the detail.

* **Who holds the money.** The escrow contract. Waybill holds no keys to it. Money leaves a deal only under that deal's own rules, and only to the supplier, the buyer, the attestors and the protocol treasury (their fees) and the arbiter (its fee).
* **What Waybill can do.** One operator wallet, the pauser, can stop new deals from being created or funded, lower the size limits at once, and schedule changes (a higher limit, a different fee range, arbiter list changes) that become effective only after a public 48-hour delay. It cannot touch money already in a deal.
* **What is checked.** The contract checks that the right people agreed, that the amounts add up, that a statement was signed by the person named, and that deadlines have passed. It does not check that goods are good: attestors sign a statement, and Waybill does not inspect anything.
* **What is public.** Everything written to the blockchain is public and permanent: wallet addresses, amounts and deadlines. The details a buyer records about goods and people are kept off the public record unless the buyer chooses to make them public.
* **What is not guaranteed.** The contracts have not had an independent audit. The limits on deal size exist because of that. A decision by an arbiter decides where one frozen part goes; it does not settle customs, tax or wider contract claims.
