# Fees and limits

All amounts are in USDC. On Arc, USDC has two forms: the ERC-20 token the escrow holds, with 6 decimals, and the chain's native gas, with 18 decimals. Waybill's escrow moves only the 6-decimal token. Gas is paid separately by whoever sends a transaction.

## The protocol fee

The buyer sets the protocol fee for each deal when creating it, in basis points of the total (100 basis points is 1%). The contract accepts only a fee inside its current range. On the mainnet deployment the range is **0.50% to 1.00%** (50 to 100 basis points).

The fee is worked out once, rounded up, and divided between the parts in proportion to their shares. A part's fee is taken only when that part is paid or decided; if the part is refunded, the fee that was prepaid for it is returned.

**Who pays** is the buyer's choice per deal:

| Mode | What the buyer deposits | What the supplier receives |
|---|---|---|
| Buyer pays (default) | Total plus the full fee | Each part in full |
| Supplier pays | Total only | Each part minus its fee |
| Split | Total plus half the fee | Each part minus its half of the fee |

**Where the fee goes.** For a part released by attestation, 60% goes to the protocol treasury and 40% is shared equally between the attestors who signed that part. For any other part, the whole fee goes to the treasury. Attestors and the treasury withdraw what they have earned from the escrow whenever they like.

## The arbiter fee

A fixed amount, set per deal, prepaid by the buyer when funding and always paid by the buyer whichever protocol-fee mode is chosen. The arbiter advertises their fee on the approved arbiter list, and the app uses it. The three arbiters on the launch list advertise a fee of 0, so deals created in the app currently carry no arbiter fee. It is paid to the arbiter if they decide a dispute before their deadline, and returned to the buyer otherwise. See [Disputes](disputes.md#the-arbiters-fee).

## Early-access limits

While Waybill is in early access, the contract refuses:

| Limit | Value |
|---|---|
| Largest single deal | **1,000 USDC** |
| Most the escrow may hold across all deals, including prepaid fees | **10,000 USDC** |

The limits are checked when a deal is created and when it is funded. Money already in funded deals is never touched by a change to them.

The operator wallet can change these limits, but only in a way you can see coming:

* **Lowering** takes effect immediately.
* **Raising** is scheduled first and takes effect only after a 48-hour public delay. The scheduled values are visible on the contract and on the operator console.

The app shows the current limits and the early-access notice. They exist because the contracts have not had an independent audit.

## Other limits in the contract

| What | Limit |
|---|---|
| Parts per deal | 1 to 8, shares adding up to exactly 100% |
| Attestors per part | 1 to 5, with a required number of signatures from 1 up to the number named |
| Arbiter panel | Empty (one named arbiter) or exactly 3 |
| Response window for a dispute | 72 hours, fixed |
| Rebuttal after a response | 24 hours |
| Address changes (payout, refund) | 48-hour delay |
| Evidence files in the app | 10 MiB each, up to 10 files per signature |

## Costs you pay yourself

Arc network gas, to sign your own transactions. Waybill's relayer sends the routine claim and refund transactions at its own cost, so you normally pay gas only for your own actions: creating, accepting, funding, signing, disputing.
