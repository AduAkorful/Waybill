# QA fix log — what changed and what to expect

Living file, newest batch first. Finding IDs (WB-QA-nnn) are from `plans/49-qa-ui-report.md`.
After each batch the web app on port 3000 is rebuilt and restarted; retest against the same tunnel URL.
"Fixed" means changed in code, covered by a unit test where the logic is pure, and the page answers as described below.
It does not mean a signed transaction was re-run in a browser — that is what QA is for.

## Batch 1 — 2026-10-20

### Transactions and errors (WB-QA-001, 008, 065, 066, 079, 098, 105)
- **Decline vs network:** "You declined it in your wallet" now appears only when the wallet itself reports a rejection (code 4001 or a rejected-request error, anywhere in the error chain). A busy or unreachable network (429, timeout, RPC error) now says: *"The network is busy or could not be reached, so we could not check this. Nothing was sent; try again in a moment."*
- **Checked before the wallet opens:** every action is simulated against the chain first. If the contract would refuse, the wallet is never opened and the reason is shown in plain words (for example *"The deal can only be cancelled after its acceptance deadline."*). Expect no more wasted gas on doomed transactions. If the check itself cannot reach the chain, nothing is offered to sign.
- **Stuck dialog:** while waiting for the wallet there is now a **Stop waiting** button and the text says nothing happens until you approve. Escape closes dialogs that are not mid-transaction (unchanged).
- **Create dialog no longer closes by itself:** the deal is frozen at the moment you press Create, so a failed background re-read can no longer close the dialog or change it under the wallet (this was the "silent close").
- Still open from this group: a 60-second wallet timeout (WB-QA-098) — the Stop waiting button is the escape for now. Contract errors not in the dictionary show as *"The contract refused it (ErrorName)"*.

### Fund and Cancel (WB-QA-002, 003, 004, 074, 077)
- **Fund** is disabled until every acceptance is in, with the reason under the button: *"Waiting for attestors · stub 0 (0x…, 0x…), arbiter (0x…) to accept."* The acceptance list now shows **every** attestor on a part (it showed only the first), and the arbiter or each panel member.
- **Cancel deal** is disabled until the acceptance deadline, with the reason: *"Can be cancelled after the acceptance deadline, <date>."* It is enabled only after that time.
- **Balance check:** opening Fund reads your USDC balance. If it is below what the deal locks, the dialog says *"Not enough USDC: this deal locks X and your wallet holds Y. Add USDC to this wallet…"* and offers nothing to sign.
- Not changed: the builder still lets you create a deal you cannot yet afford (WB-QA-077); it is blocked at Fund.

### Wording and status (WB-QA-010, 015, 093)
- A part that is ready for the relayer to pay now reads **"Ready to pay"** (中文: 待付款), not "Paying supplier".
- A funded deal with disputes now says e.g. **"Funded · 3 parts in dispute"** in the record header, the page description and the buyer deal page. Plain "Funded" appears only when nothing is disputed.
- Not changed: 1.01 vs 1.0075 display rounding (WB-QA-015, second half).

### Supplier page `/d/<id>` (WB-QA-005, 011, 088)
- `/d/abc` and `/d/999999` now return **404** (not 200 or a hang).
- A signed-in wallet that is not the named supplier — including the payout-only address — now sees **"This deal is for another wallet"** with a sign-out link, in every deal state (before it appeared only while the deal was still waiting for acceptance).
- The "Your deal" heading for non-proposed deals is now neutral, **"Deal status"** (中文: 交易状态), because the page cannot know who is reading it.

### Builder (WB-QA-009, 031 part, 103)
- The all-zero address is refused for any address field.
- A mixed-case address whose checksum does not match is refused: *"…does not pass the address checksum. Check it for a typo."* All-lowercase and all-uppercase addresses are still accepted.
- The refund address cannot be the supplier.
- The panel option is disabled with a reason until three arbiters are on the approved list (*"A panel needs three arbiters on the approved list; 1 is on it now."*). It becomes usable after the two pending arbiters are executed.
- Not changed: dust totals, per-part USDC amounts, "0.00%" display, 1-part custom deals (WB-QA-031/032/064).

### Network (WB-QA-007)
- Everything under `/app` now renders only when the wallet is on Arc; otherwise you see **"Your wallet is on a different network"** with a **Switch to Arc** button, and no signing control. This covers `/app`, `/app/new`, `/app/deals/*`, `/app/attest/*`, `/app/room/*`, `/app/settings`.
- The wallet login is configured with Arc as default and only supported chain. We cannot control the chain id inside the wallet's own sign-in message; if Rabby still shows chain id 1 on the first sign-in, note it but it is expected to be the wallet's own prompt.
- `/join` only shows an address to copy (no signing), and `/operator` actions rely on the pre-flight check above (a wrong-chain wallet gets *"Wallet is connected to the wrong network. Nothing was sent."*).

### Not bugs / answered
- **WB-QA-006 / 084 (index undercount):** deliberate. The relayer indexes from block 68143000 for a fast first sync; the live count on the home page reads the chain. The operator page's volume table covers only the indexed range. Use `/v1/operator` `chain.totalDeals` for the full count.
- **WB-QA-026 (explorer host):** `testnet.arcscan.app` redirects to `explorer.testnet.arc.io`; they are the same site.
- **WB-QA-057 (429s):** the public RPC rate-limits; a dedicated RPC is needed for heavy QA. With batch 1 these now say "network busy", not "declined".
- **WB-QA-014 (CSP):** the full policy stays report-only until reports are clean.
- **WB-QA-056:** Rabby cannot simulate Arc transactions; not a Waybill defect.

### Retest checklist for batch 1
1. Throttle or break the RPC mid-flow → message says network busy, never "declined". Reject in Rabby → "You declined… Nothing was sent. You can try again."
2. Deal with an unaccepted attestor 2 → Fund disabled, reason names every missing party; Cancel disabled with the deadline.
3. Cancel on deal 286 before its deadline → button disabled, no wallet prompt.
4. Fund 288 as BUYER_4 → "Not enough USDC", no wallet prompt.
5. `/d/285` as a stranger and as SUPPLIER_3 (payout only) → "This deal is for another wallet".
6. `/d/abc`, `/d/999999` → 404.
7. `/record/284` and `/app/deals/284` → "Funded · 3 parts in dispute". `/app/deals/287` part 0 → "Ready to pay".
8. Builder: zero refund, bad-checksum supplier, refund = supplier → each refused. Panel option disabled until three approved arbiters.
9. Wallet on another chain → `/app/*` shows the Switch to Arc card.
10. Press Create, then let the wallet sit → dialog stays open with Stop waiting; no silent close.

### Next batch (not started)
Accessibility (labels, focus rings, tap targets, alert strategy), layout (attestor profile, sticky create, operator mobile table), copy (titles, `lang`, default language), receipt strip, OG image, aggregate remaining items from the report.
