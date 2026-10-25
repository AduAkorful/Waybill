# Disputes

A dispute freezes one part of a deal. The other parts carry on, and the deal cannot settle while any part is frozen. This page describes what the contract does; the exact states and checks are in [Deal lifecycle](reference/deal-lifecycle.md).

## Who can dispute, and when

* **The buyer** can dispute a part while it is in review, before its review window ends.
* **The supplier** can dispute a part that is overdue, during its grace period.

The person disputing gives a written reason and can attach files. The app stores the files and sends only a fingerprint of them to the contract, so the contract holds a permanent record of exactly what was submitted.

## The clocks

1. **Response window: 72 hours.** The other side can respond with their account and files. This is fixed by the contract.
2. **Rebuttal: 24 hours.** If a response arrives, the side that raised the dispute has 24 hours to read it and answer, then the arbiter can decide. The person who raised the dispute can end this early (waive the rebuttal) if they have nothing to add.
3. **Decision window.** The arbiter has the number of hours the buyer chose when creating the deal, counted from when decisions open. If nobody responded, decisions open when the 72-hour response window ends.

Both sides can add evidence until the arbiter's deadline. Each addition is recorded in order and cannot be changed.

## What the arbiter can decide

For the frozen part only, the arbiter chooses one of:

* **Pay the supplier.**
* **Refund the buyer.**
* **Split it.** A percentage to the supplier (anything from 0 to 100%, in steps of 0.01%), the rest to the buyer. The protocol fee is charged only on the share that goes to the supplier; the buyer gets back their prepaid fee for the rest.

The decision applies at once, in one transaction. The arbiter writes their reasoning, which the app stores with the dispute files so both sides can read it.

If the deal uses a panel of three arbiters, each member casts a vote (supplier, buyer, or a split percentage) and the first two matching votes decide.

## If the arbiter does not decide

After the arbiter's deadline, anyone can apply the default:

* A dispute the **buyer** raised is **refunded to the buyer**.
* A dispute the **supplier** raised is **paid to the supplier**.

The arbiter fee then goes back to the buyer, because the arbiter did not do the job.

## Withdrawing a dispute

The buyer can withdraw a dispute they raised at any time before it is decided. The part goes back to being payable, and the supplier is paid. A supplier's dispute cannot be withdrawn this way; the other side's response or the arbiter's decision ends it.

## The arbiter's fee

The buyer prepays a fixed arbiter fee when funding the deal. It is held apart from the deal's money. It goes to the arbiter if they decide a dispute before their deadline. If no dispute is ever decided, or the arbiter misses the deadline, it returns to the buyer. The arbiter withdraws their fees deal by deal.

## Careless attestors

An attestor who signs a statement that turns out to be wrong can be penalised through a bond, if they have deposited one. See [Contracts](reference/contracts.md#bond-vault). The arbiter of a deal can flag the attestor on a disputed or decided part. After a 72-hour appeal period, a share of the attestor's bond goes to the harmed party (never to Waybill). Each executed penalty is recorded against the attestor in the public registry, and every third one schedules a suspension, which stops them being named on new deals.

## What a decision does not do

An arbiter's decision settles where one frozen part goes. It does not settle customs, tax or wider claims between the buyer and the supplier, who keep their legal remedies.
