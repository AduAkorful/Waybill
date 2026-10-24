# QA fix log — what changed and what to expect

Living file, newest batch first. Finding IDs (WB-QA-nnn) are from `plans/49-qa-ui-report.md`.
After each batch the web app on port 3000 is rebuilt and restarted; retest against the same tunnel URL.
"Fixed" means changed in code, covered by a unit test where the logic is pure, and the page answers as described below.
It does not mean a signed transaction was re-run in a browser — that is what QA is for.

## Batch 5 — 2026-10-20 (minimum total, create warning, rounding, combobox, API)

Web app and relayer restarted on the new code. axe: 0 violations on the public pages and `/operator` at 375 and 1440 px, light and dark.

### Builder (WB-QA-031 dust, 077, 060)
- **Minimum total: 1 USDC.** Anything lower is refused: *"The total must be at least 1 USDC."* This is a product rule set in the app (not read from the contract); 1 USDC exactly is accepted. It applies when creating a deal; existing deals are unchanged (deal 288 and others stay as they are).
- **Create-time balance warning:** when the wallet holds less than funding will lock, the summary shows *"Your wallet holds X USDC and funding will lock up to Y. You can still create the deal, but you will need to add USDC before you can fund it."* Creating is still allowed; funding is still blocked until the balance is enough.
- **Attestor field is a real combobox:** type a name or address and pick from suggestions with the arrow keys and Enter; Escape closes the list. Suggestions show the registry name with the address underneath (all campaign attestors are named "Waybill test" in the registry, so names still look alike).

### Numbers and wording (WB-QA-015 rounding, 083, 028)
- The big counters stay rounded to the cent. When any figure has sub-cent digits, an **"Exact: released … · held … · refunded … USDC"** line appears under them, so a record showing 1.01 also shows 1.0075.
- Address-change history lines now say **"after the 48-hour delay unless the other side rejects it"** (no more "buyer's/supplier's review delay").

### API (WB-QA-016, 017)
- `GET /v1/deals/<id never issued>` now answers **404 `deal_not_found`** (was 200 with zero addresses).
- `GET /v1/network` now includes **`indexStartBlock`** (currently `"68143000"`): deals created before it have no indexed history, so an empty events list for them means "not indexed", not "no events".
- Not changed: 401 vs 405 order on evidence routes (WB-QA-085).

### Reduced motion (WB-QA-072)
- With `prefers-reduced-motion: reduce` the code skips the stub tear, counter roll and dialog animations, and a global rule stops CSS animations. Automated browser emulation showed no running animations and no style changes after load in either mode, so it cannot show the difference on its own: **QA should verify by eye** (OS "reduce motion" on: counters appear at their final value, parts do not tear).

### Retest checklist for batch 5
1. `/app/new`: total 0.99 refused, 1 accepted; with a low-balance wallet the warning appears and Create still works.
2. Attestor field: type "Way", arrow down, Enter; Escape closes the list.
3. A record or deal with a fee like 0.0075 shows the "Exact:" line.
4. `curl <api>/v1/deals/999999` is 404; `curl <api>/v1/network` shows `indexStartBlock`.
5. Reduced motion on: open `/record/284`, `/app/deals/<id>`.

### Still open
Arbiter and attestor pickers show registry names only as far as the registry has them (data); 401 vs 405 ordering; enforcing a script-source CSP (waiting for clean report-only data); Privy's own stray tab stops (third party); Chinese and legal text review; signed-in axe run.

## Batch 4 — 2026-10-20 (fee amounts, operator role, wallet timeout, evidence reads)

Web app restarted on the new build. axe: 0 violations on the public pages and `/operator` at 375 and 1440 px, light and dark.

### Builder summary (WB-QA-033, 031 part)
- The fee line now says who pays what in USDC, following the escrow's own rule: *"You prepay all of it (X USDC)…"*, *"Taken from the supplier at payout (X USDC); you prepay none"*, or *"Split: you prepay X USDC, the supplier pays Y USDC at payout"* (the buyer gets the larger half when it does not divide evenly).
- **"At most you lock"** is now correct for a split fee (it used to count the whole fee only for buyer-pays and nothing for a split). It matches what the Fund dialog shows after creation.
- Not changed: dust totals are still allowed.

### Operator (WB-QA-050 part)
- The header shows the connected wallet and its role: **"0x4632…D0F1 · pauser"**, **"… · not the pauser (read only)"**, or "No wallet connected".

### Wallet waiting (WB-QA-098)
- After 60 seconds waiting for the wallet the dialog text becomes *"Still waiting for your wallet. If you closed its window, stop waiting and try again."* (the Stop waiting button from batch 1 is there from the start).

### Evidence (WB-QA-042)
- Opening the files of several parts now asks for **one** wallet signature per deal for about eight minutes, not one per part. A declined signature is not remembered; the next click asks again.

### Retest checklist for batch 4
1. `/app/new`: pick each fee payer and read the fee line and the "At most you lock" total; fund the created deal and compare with the Fund dialog.
2. `/operator` as the pauser and as another wallet: header chip text.
3. Leave the wallet prompt untouched for a minute: text changes.
4. Open "Show the files" on two parts of deal 284: one signature prompt.

### Not done in this batch
Arbiter and attestor pickers still show addresses (arbiters have no profile; attestor names are whatever the registry holds, all "Waybill test" today); dust minimum; Chinese copy review; legal text review; signed-in axe run. These need either data or a decision.

## Batch 3 — 2026-10-20 (builder amounts, receipts, loading, copy)

Web app and relayer restarted on the new code (the relayer now reports which optional services are on). axe: 0 violations on the public pages and `/operator` at 375 and 1440 px, light and dark.

### Builder (WB-QA-031 part, 047, 064)
- Each part shows what its share is worth in USDC under the percentage box (rounded down to the micro-USDC; the escrow settles any remainder), or "—" until the total and share are valid.
- A comma decimal ("1,5") now says *"Enter the total with a dot for decimals, like 1500.50"*.
- The custom template says "from one to eight" parts, matching what is allowed.
- Not changed: tiny "dust" totals are still allowed (the fee rounds up on them); the fee-payer summary still describes a split fee in words, not amounts.

### Attestor (WB-QA-029, 104)
- After you have signed a part, it shows **"Your confirmation is recorded"** instead of the upload form again. This is read from the indexed signing events, so it needs the relayer to be up; if it is not, the form can appear but the pre-flight check refuses with "This attestor has already signed for this part" before the wallet opens.

### Receipts (WB-QA-027, 045)
- Every confirmed step leaves a small card at the bottom right ("<step> · confirmed", short hash, explorer link, × to dismiss) that stays after the dialog closes. It lives only in the page (cleared on reload) and covers all signed flows including accept-arbiter and accept-attestor.

### Copy (WB-QA-028 part, 040)
- "Stub n" is now **"Part n"** everywhere visible (cards, screen-reader labels, the acceptance list).
- The dispute form says *"Disputing freezes only this part. The other side then has N hours to respond; after that the arbiter can decide."* (N from the deal).
- The 404 page tells people to check the deal number in the link and offers Sign in.
- Remaining "UTC UTC" doubling on the attestor screens removed.

### Loading and notices (WB-QA-012, 022 part, 037)
- Deal, attest, room and operator pages show placeholder bars with the loading text instead of a bare line.
- **Settings:** the page asks the relayer first. With email off it says *"Email updates are not switched on for this site yet… You will not be asked to sign anything here."* and shows no sign button. (Right now email is off, so expect that message.)

### Link previews (WB-QA-013)
- `/record/<id>` now has an `og:image` (a generated card: "Deal N · Funded · 3 parts in dispute", amount, part count; unfunded deals show only "Deal N"). The URL is absolute from the server's own address; set `WAYBILL_SITE_URL` (server env) to the public address (for example the tunnel URL) so previews use it. Without it the image URL points at localhost.

### Contrast
- The light theme's alert red is slightly darker (`#b3270f`) so error text passes AA on the card background.

### Retest checklist for batch 3
1. `/app/new`: change the total and shares, each part shows its USDC; type `1,5` as the total.
2. As ATTESTOR on 284 after signing: no upload form.
3. Do any signed step; the receipt card stays after the dialog closes and links to the explorer.
4. `/app/settings`: message that email is off, no signature requested.
5. `curl -s <web>/record/284 | grep og:image`; open the image URL.
6. Open a dispute dialog: 72h-style text present. `/d/abc`: new 404 text.
7. Throttle the network and open `/operator`, `/app/deals/<id>`: placeholder bars appear.

### Next batch (not started)
Builder: dust minimum and fee-payer amounts in the summary, ENS/checksum policy note, attestor/arbiter pickers with registry names; operator wallet-role chip; per-part evidence signing reuse; 60-second wallet timeout; remaining table items in the report.

## Batch 2 — 2026-10-20 (accessibility, layout, copy)

Web app rebuilt and restarted on port 3000. Automated check: axe-core found **0 violations** on `/`, `/attestors`, `/record/*`, `/d/<id>`, `/signin`, `/join`, `/legal`, `/operator` at 375 px and 1440 px, light and dark. Signed-in pages (`/app/*`) cannot be audited without a session — QA should run axe there.

### Titles, language, chrome (WB-QA-018 part, 019, 020, 038, 039, 061, 071)
- Page titles no longer double the brand: **"Your deals · Waybill"**, not "· Waybill · Waybill". Every page now has one "· Waybill" suffix.
- The supplier page sets `lang="zh-Hans"` when 中文 is chosen (English otherwise). The language defaults to English; it switches to 中文 only if that was chosen earlier **in the same browser profile** (it is remembered), which explains the "first visit in Chinese" report — use a clean profile to confirm.
- Times show one zone label: **"21:15 UTC"** (was "GMT UTC").
- Public header has a **Sign in** button. `/d/<id>` has the same footer text and a Terms/privacy link.
- `/join` copy now says "Sign in with your email… or connect a wallet you already have", button "Sign in or connect a wallet".

### Accessibility (WB-QA-021, 023, 030, 032 part, 034, 046 no, 060 no, 090)
- Text boxes no longer hide the keyboard focus ring (`outline-none` removed; the global ring shows).
- On phones (≤640 px) buttons, selects and text inputs are at least 44 px tall.
- Balance/odometer figures are one image-role element with the full amount (no per-digit reading).
- Builder: every field has an `id` and `name`; supplier, total and refund get `aria-invalid` when they have a problem; the problem list is no longer an alert region (it no longer re-announces on every keystroke) and the Create button points at it with `aria-describedby`; "Remove" buttons say which part or attestor ("Remove part 2", "Remove attestor 2 from part 1").
- Attestor portal: the conflict radios and the file/notes fields are unique per part ("Files Files Files" and the shared radio group are gone).
- Not done: attestor suggestion list is still a plain datalist (060), Privy's stray tab stops (046, third-party), reduced-motion verification (072).

### Layout (WB-QA-022 part, 025, 035)
- Attestor profile uses two columns on desktop (identity and counts left, registry history right) and stays one column on phones.
- Operator volume table becomes stacked cards on phones (no clipped columns); its note now says the index does not start at the first deal.
- Builder on phones has a fixed **Create deal** bar at the bottom (also shows "fix the problems above" when disabled). Desktop keeps the sticky summary.
- Not done: skeleton loaders (022/037), per-part USDC amounts in the builder.

### Dialogs (WB-QA-036 part)
- Change-address dialog keeps **Cancel** when the typed address is invalid and says what is wrong.
- Could not reproduce the truncated "Write at le…" message (062); the text is a normal paragraph. Retest and send the viewport if it recurs.

### Retest checklist for batch 2
1. Titles of `/app`, `/signin`, `/operator`, `/join`, `/d/<id>`: one "· Waybill" only (the home page is just "Waybill").
2. Tab through `/app/new` at 375 px: each field shows a focus ring, controls are tall enough, the Create bar stays at the bottom.
3. `/operator` at 375 px: volume appears as cards. `/attestors/<address>` at 1440 px: two columns.
4. `/d/284` in 中文: footer and statuses in Chinese, `html`/wrapper `lang=zh-Hans`.
5. Run axe on `/app/new`, `/app/deals/<id>`, `/app/attest/<id>`, `/app/room/<id>` with a signed-in session.

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

