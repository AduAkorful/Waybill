# Deal lifecycle

Every rule on this page is enforced by the escrow contract. Times are Unix seconds on the chain; "hours" fields are whole hours.

## Deal states

| State | Meaning | Moves to |
|---|---|---|
| `PROPOSED` | Created, waiting for acceptances. Nothing is locked. | `ACCEPTED` when everyone has accepted; `FUNDED` if funded; `CANCELLED` |
| `ACCEPTED` | The supplier, the arbiter (or all three panel members) and every attestor of every attestation part have accepted. | `FUNDED` |
| `FUNDED` | The buyer has locked the money. Parts now move. | `SETTLED` |
| `SETTLED` | Every part is paid, refunded or decided, and no refund is pending. | none |
| `CANCELLED` | Cancelled after the acceptance deadline passed without full acceptance. | none |

**Acceptance deadline.** A timestamp the buyer sets, which must be in the future when the deal is created. Acceptances after it are refused. If it passes without full acceptance, anyone can call `cancelUnaccepted`.

**Funding.** Only the buyer, and only while new deals are not paused. The contract pulls `total + prepaid fee + arbiter fee` in one transfer. If that would take the escrow's held total above the cap, funding is refused.

**Fund-first deals.** The contract also supports deals that the buyer may fund before everyone has accepted. Nothing can be paid until everyone has accepted, and if the supplier has not accepted by the deadline, `cancelUnaccepted` returns the buyer's unreleased money and cancels the deal. The app does not create these.

## Part states

| State | Meaning |
|---|---|
| `WAITING` | Waiting for its condition. |
| `IN_REVIEW` | The condition is met and the review window is running. |
| `CLAIMABLE` | Payable now. |
| `RELEASED` | Paid to the supplier. Final. |
| `OVERDUE` | Its due date passed without the condition being met (not used by timed parts). |
| `REFUNDABLE` | The grace period ended; the buyer can be refunded. |
| `REFUNDED` | Returned to the buyer. Final. |
| `DISPUTED` | Frozen by a dispute. |
| `RESOLVED` | Decided by the arbiter, or by default. Final. |

Each part has: a share of the total in basis points, a release condition, a due date (`deadline`, a timestamp), a grace period in hours, a review window in hours, and optionally a prerequisite part.

### Release conditions

| Condition | What moves it out of `WAITING` |
|---|---|
| `ACCEPTANCE` | Funding the deal: it goes straight to `IN_REVIEW` (or `CLAIMABLE` when the review window is 0). |
| `ATTESTATION` | Enough named attestors sign (`attest`). The required number is the part's threshold. |
| `BUYER_APPROVAL` | The buyer calls `approveMilestone`. |
| `TIMED` | Its due date passes and someone calls `claim`. |

When a part's condition is met it goes to `IN_REVIEW` for its review window, or directly to `CLAIMABLE` if the window is 0 hours.

### Review

While a part is `IN_REVIEW`:

* The buyer can call `approveMilestone` to make it `CLAIMABLE` early.
* The buyer can call `dispute`, which makes it `DISPUTED`.
* When the window ends, `claim` moves it to `CLAIMABLE` and pays it in the same call.

### Payment

`claim` is open to anyone. It pays the supplier's payout wallet the part's share of the total, minus any protocol fee the supplier pays (see [Fees and limits](../fees-and-limits.md)), and marks the part `RELEASED`. It requires that the supplier's payout wallet is set, that the deal is fully accepted, and that any prerequisite part is already `RELEASED`.

If the USDC transfer fails (for example the recipient is blocked by the token), nothing is lost and nothing reverts: the part stays `CLAIMABLE`, `PayoutFailed` is emitted, the locked amount is restored and the fees are not taken. The supplier can then propose a new payout wallet; once the 48-hour delay has passed anyone can apply it and `claim` again.

When the last part reaches a final state, the deal becomes `SETTLED`, and each attestor who signed has an `Attested` outcome recorded in the registry.

### Overdue, grace and refund

A part that is not `TIMED` and still `WAITING` after its due date becomes `OVERDUE`. This is applied the next time anyone touches the part, so there is no separate transaction for it.

During the **grace period** (the due date plus the part's grace hours):

* named attestors can still sign;
* the supplier can dispute the part.

When the grace period has ended, anyone can call `applyDefault` to make the part `REFUNDABLE`, unless it is disputed. Then anyone can call `refund`, which returns that part's share to the buyer's refund wallet, with the fee the buyer prepaid for it, and **also refunds every later part that is not yet final**. Parts that are already `RELEASED`, `REFUNDED`, `RESOLVED` or `DISPUTED` are left alone. If a refund transfer fails, that part stays `REFUNDABLE`, the amount stays locked, `CascadeRefundPending` is emitted and the deal cannot settle until the refund is retried with `retryCascadeRefund`.

### Prerequisite parts

A part can name an earlier part (a lower index) that must be `RELEASED` before it can be claimed or approved. The app does not set this: its parts are always independent.

## Disputes

See [Disputes](../disputes.md) for the clocks and the outcomes. In state terms:

* `dispute`: `IN_REVIEW` → `DISPUTED` (buyer), or `OVERDUE` → `DISPUTED` (supplier, within grace).
* `resolve` or `resolveSplit` by the arbiter, or two matching panel votes: `DISPUTED` → `RESOLVED`, paying the supplier, the buyer, or both.
* `applyDefault` after the arbiter's deadline: `DISPUTED` → `RESOLVED`, paying the supplier if the supplier raised the dispute and refunding the buyer if the buyer did.
* `withdrawDispute` by the buyer, for their own dispute: `DISPUTED` → `CLAIMABLE`.

## Changing an address

| Change | Who proposes | Who can reject | When |
|---|---|---|---|
| Supplier's payout wallet | The supplier | The buyer | While the deal is `FUNDED` |
| Buyer's refund wallet | The buyer | The supplier | While `FUNDED` or `SETTLED` (so a failed refund can be redirected) |

Either change takes effect only after 48 hours, and anyone can apply it once the delay has passed. The wallet that was in place is used until then.

## Money accounting

The escrow tracks `currentLocked`: the principal plus prepaid fees it is holding for open parts, plus any arbiter fee not yet moved. It rises when a deal is funded and falls only when money actually leaves. This is the figure the total cap is checked against. A failed transfer restores it, so the cap always reflects money really held.
