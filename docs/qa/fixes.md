# QA fix log — what changed and what to expect

Living file, newest batch first. Finding IDs (WB-QA-nnn) are from `plans/49-qa-ui-report.md`.
After each batch the web app on port 3000 is rebuilt and restarted; retest against the same tunnel URL.
"Fixed" means changed in code, covered by a unit test where the logic is pure, and the page answers as described below.
It does not mean a signed transaction was re-run in a browser — that is what QA is for.

## Known, by design, or not code — please do not re-report

These come up in retests. Each has a reason. If one of them is wrong *for a different reason than given here*, say so; otherwise list it as "known" and move on.

### Product decisions (working as intended)
| What you see | Why |
|---|---|
| No language toggle on the front page, record, directory, legal or sign-in pages (MW-05) | Only the supplier page `/d/*` has Chinese copy, and that copy is still a draft pending a native review. A toggle on pages with no Chinese text would switch nothing. It needs the Chinese for those pages written and reviewed first. |
| 中文 is not preselected for a Chinese browser (NF-24) | Deliberate: the page is never switched without asking. A Chinese browser with no saved choice sees the banner "查看中文版本 · View this page in Chinese" on `/d/*` (batch 7). It only shows on a browser whose language is Chinese, and QA's browsers are not. |
| "Accept as attestor", "Accept as arbiter", "Connect wallet" and the "Your deals" button are links, not `<button>` elements (SF-04, SF-05) | Each one opens another page; a link is the correct element and is announced as a link. Only the look is button-like. |
| `/signin`, `/join` and the 404 still have empty space at 1440 px (NF-04, NF-23) | Short pages with one task. `/join` and the 404 now carry extra content; `/signin` is a centred form beside a steps panel. More filler was judged worse than space. Blank space on a short page is not a finding on its own. |
| In 中文 the part names, goods and city names stay as the buyer typed them (NF-18) | They are the buyer's own words, never translated. Labelling them is optional and not planned. |
| There is no fees, pricing, how-it-works or help page; `/fees` is a 404 | None has been written. The fee is per deal and shown in the deal's terms. |
| Every attestor row reads "Waybill test" | That is the profile name those test wallets published to the registry. It is data on the chain, not text in the app. |
| Deal 280 appears in the arbiter's "needs you" list | It is a real proposed deal that names that wallet as arbiter, so it does need an accept. |
| The history on a record cannot be tied to a deal number on an attestor profile | The registry records outcomes, not deal numbers. |

### Not a code issue (environment, free tiers, or waiting on someone)
| What you see | Why | Who acts |
|---|---|---|
| Pages and tab switches take 5 to 20 seconds; the first open of a deal takes 5 to 8 seconds (SF-12, RT-05) | The test box is reached through a free ngrok tunnel and the chain is read through the free public Arc RPC. Both are slow and rate-limited. The app already caches and shares reads; a second open is instant. Re-time on the local address (`http://localhost:3000`) to separate the app from the tunnel. | Nobody; a dedicated RPC and a real host would be the fix, and the owner chose free tiers. |
| 503 or 404 from the tunnel when several pages load in parallel | ngrok free-tier rate limiting. Load one page at a time. | – |
| Sign out takes 5 to 8 seconds | It waits for the wallet library's server to end the session, across the tunnel. The button now says "Signing out…" at once and the browser is cleared either way. | – |
| Console messages "preloaded but not used" | The framework's font preload hints. Harmless. | – |
| Emails (8.1 to 8.8) cannot be tested | No Resend key is configured on the relayer, so email is off; Settings says so. | Owner: add a Resend key and sender. |
| Panel (three-arbiter) deals cannot be created | Two of the three arbiters (`0xd173…1EB3`, `0xD77c…8BC1`) are scheduled but not yet executed on the list. | Owner: execute the two additions from the pauser wallet. |
| Deal 284 decisions, deal 285 part 3, the 285 address change, the relayer claiming 287 | They wait for real on-chain deadlines (arbiter decisions 2026-10-23 about 14:30 UTC, 285 address change after 2026-10-22 15:08 UTC). Time is not forged. | Wait. |
| The wallet-relayed "request limit" wording (WB-QA-001) | It can only be seen when the public RPC actually rate-limits a wallet. The wording is in place and unit-tested. | QA: note it if it happens. |
| Reduced-motion behaviour | It cannot be checked in headless emulation. | QA: check by eye with the OS "reduce motion" setting on. |
| A new email wallet cannot accept a deal (first accept fails) | A wallet created by sign-in starts with no USDC, and accepting is an Arc transaction that pays its network fee in USDC. Waybill does not sponsor accepts (it only sponsors claims and refunds). The app now says so in plain words (`/join` and when the wallet has no USDC), and the buyer sends a small amount with the deal link. | Buyer / operator, during testing. |
| Console lines `Privy logout 400` and `sessions 401` after Sign out (SF-15) | The browser reports a failed network call to the wallet library's own server (the session had already ended there). A page cannot hide a failed request from the console, and the person is signed out either way. | – |
| NF-19 message seen with Rabby (SF-17) | See batch 13: the app now checks the balance first, so the wallet is not opened. | – |

## Batch 14 — 2026-10-21 (findings from the batch 13 retest, report §21)

Web app rebuilt and restarted; no relayer or contract changes. Measured in a browser at 1280 and 1440 px: the logo and the page content now start at the same x on `/`, `/record`, `/d`, `/attestors`, `/join`, `/operator` and the 404; axe 0 violations on `/signin`, `/legal`, `/operator`, `/d/abc` at 320 and 1440.

### Fixed
- **Content not under the logo (NF-32):** every page's content now uses the same width and side padding as the header (logo and content both at x=96 at 1280, x=176 at 1440).
- **`/app/attest/<id>` too narrow (SF-21):** same wider container; the statement and the accept panel sit side by side from 1024 px.
- **`/signin` desktop layout (SF-22):** both halves sit inside the header's container; the value panel is a card under the logo, the headline and steps are grouped, and the form column is 416 px.
- **`/legal` (NF-31):** wider layout with a sticky contents list in the left column from 1024 px (the link row stays on top on phones).
- **`/join` and the 404:** same container, so they line up with the logo.
- **Contrast on `/operator` (NF-33):** the green figures are darker (`#08683e`), above 4.5:1. This applies to every green figure on the site.
- **Create deal on desktop (SF-20):** pressing it with problems moves focus to the problem list and flashes it, as on phones.
- **`/app/new` loading (SF-24):** the escrow's limits are remembered for the visit, so a second visit shows the form at once. The first visit still waits for one read (the form needs the live fee range and caps to check what you enter).

### Not changed, and why
- **`/d/<id>` staying on "Reading the deal…" (SF-23):** the first open of a deal is a cold read through the free tunnel and free RPC (see the "not code" table). The page updates itself after your own transaction (a refresh waits 2.6 s so the shared read cache cannot return the old state). A second open is instant.

### Retest checklist for batch 14
1. 1280 and 1440: logo and the left edge of the content line up on every page.
2. `/signin` at 1440: card and form inside the header's width.
3. `/legal` at 1280: contents list on the left, stays in view while scrolling.
4. `/operator`: green figures pass contrast.
5. `/app/new` desktop: press Create with an empty form; the list is focused and flashes.

## Batch 13 — 2026-10-21 (findings from the batch 12 retest, report §19)

Web app rebuilt and restarted; no relayer or contract changes. Checked with a browser at 320, 375 and 1440 px: axe 0 violations on 12 pages at 320 and 1440, no horizontal scroll.

### Fixed
- **No USDC for the fee, before the wallet opens (SF-16, SF-17, NF-19):** before asking the wallet to sign anything, the app now reads the wallet's USDC balance, estimates the fee, and if the balance cannot cover it shows *"This wallet has no USDC to pay the network fee. Send it a small amount of USDC on Arc first. Nothing was sent."* with a **Copy my wallet address** button. The wallet popup is no longer opened with a greyed-out Sign, and "You declined it" is no longer shown for this case.
- **Double click on Continue → Accept role (SF-18):** a button that has just appeared ignores clicks for 0.6 s, so a double click cannot reach the wallet.
- **Create deal gave no feedback (SF-19):** the button is no longer dead while something is still wrong. Clicking it shows the list of problems and scrolls to it.
- **Signed-in `/d/*` header at 320 px (SF-08, SF-13):** one row (66 px) with logo, EN | 中文, Deals, theme. Spacing and logo size tighten under 360 px.
- **"Connect wallet" flash on `/operator` (SF-09, SF-14):** the chip stays blank until the sign-in service and the wallet connection have both settled. Direct load polled every 100 ms: never shown.
- **404 look-up (NF-23, NF-25, NF-26, NF-27):** letters and spaces are dropped as you type ("2 8 4" becomes 284). An empty value says "Type the deal number first". A number that does not exist says "There is no deal 999999 on this network yet. The newest is 290." and stays on the page. The button keeps its full colour.
- **Phone status card (NF-21, NF-28):** figures are 22 px under 640 px and never wrap, so "USDC" stays on the same line as the amount on iPhone SE.
- **Record escrow link (NF-29):** 44 px tall.
- **`/signin` on desktop (NF-30):** the shared header at every width (the split panel sits under it); the email field is 16 px.
- **Small targets:** the EN pill and the `/legal` "Terms" link are at least 44 px wide.

### Not changed, and why
- **Privy logout 400 / sessions 401 in the console (SF-15):** see the "not code" table above.
- **EN/中文 pills 40 px tall on desktop:** deliberate (compact control on a pointer device); phones use 44 px.

### Retest checklist for batch 13
1. With a wallet that holds 0 USDC (Rabby, address not funded), open a deal that needs its accept: the message above and the copy button appear, and the wallet does not open.
2. Fund that wallet with a little USDC and repeat: the wallet opens and the accept goes through.
3. 320 px, signed in, `/d/284`: one-row header.
4. `/d/abc`: type `2 8 4a` → field shows 284; Open → record 284. Type 999999 → message, stays. Empty → message.
5. `/app/new` with the form incomplete: press Create deal; the problem list appears.
6. `/signin` at 1440: shared header, one logo, email field 16 px.
7. Direct load of `/operator` signed in: no "Connect wallet" flash.

## Batch 12 — 2026-10-21 (findings from the batch 11 retest, report §17)

Web app rebuilt and restarted; no relayer or contract changes. The list of things that are *not* code issues is the section above.

### Fixed
- **"Nothing needs you today" flash (SF-07, RT-24):** the list now reports "done" only for the list it actually read. While a wallet's deals load, or between two lists, it says "Reading your deals…".
- **Signed-in `/d/*` header at 320 px (SF-08):** the link reads "Deals" under 400 px and "Your deals" above.
- **"Connect wallet" flash on `/operator` (SF-09):** the chip is blank until the sign-in state is known.
- **Sign out feedback (SF-10):** the button changes to "Signing out…" at once and is disabled; it still clears the browser's sign-in even if the server call is slow or fails.
- **`/signin` (SF-11, MW-20):** the phone view uses the shared header. The email form works before the sign-in service has started: pressing "Send code" early says "Starting sign-in…" and sends as soon as the service is ready.
- **Coinbase Smart Wallet message (SF-12):** the wallet list now asks Coinbase's wallet for a plain (non-smart) connection, since its smart wallet does not support Arc. Console: the unsupported-chain message should be gone; retest with Coinbase Wallet if QA has it.
- **A new wallet with no USDC (NF-19):** a failed send for lack of funds now says *"This wallet has no USDC to pay the network fee. Send it a small amount of USDC on Arc first. Nothing was sent."* `/join` says plainly that a new wallet starts empty and that the buyer should send a small amount of USDC with the deal link. (Waybill does not sponsor accepts; see the "not code" table.)
- **`/join` repeated itself (NF-20):** the address is called "not secret" once (in the answer), the intro is one line.
- **Status card on phones (NF-21):** Total on top, Paid to you and Held side by side. Units are attached to each figure.
- **Operator slot order (NF-22):** at tablet and desktop widths the wallet chip comes after Attestors, like the supplier page's control. On phones it keeps its own row.
- **Supplier page container (NF-03):** the header uses the same width as the public pages, so the logo no longer jumps.
- **404 (NF-23):** a "Look up a deal number" field opens that deal's public record (digits only).
- **Small targets (NF-17):** the record's transaction links and Print button are 44 px tall at every width.

### Retest checklist for batch 12
1. `/app/arbiter` right after signing in: "Reading your deals…" from the first paint, never "Nothing needs you today" until the count finishes.
2. 320 px signed in, `/d/284`: header on one row ("Deals").
3. `/operator` signed in, direct load: no "Connect wallet" flash. Press Sign out: the button says "Signing out…".
4. `/signin` on a phone: shared header; press Send code before the page finishes loading, then it sends.
5. Send a transaction from a wallet with 0 USDC: the "no USDC to pay the network fee" message.
6. Desktop `/operator`: logo, Attestors, wallet chip, theme.
7. `/d/abc`: type 284, press Open: the record opens.

## Batch 11 — 2026-10-21 (findings from the batches 8–10 retest, report §15)

Web app rebuilt and restarted; no relayer or contract changes.

### Fixed
- **Sign out on `/operator` did nothing (SF-01):** every Sign out button (app, operator, supplier page, `/join`) now ends signed out even when the wallet library's logout call fails: it clears the sign-in the browser holds and reloads. After Sign out you land on the front page (supplier page: the same page; `/join`: `/join`).
- **`/d/*` and `/operator` headers broke into three rows at 320 px (NF-01, NF-16):** the language switch is a compact "EN | 中文" and Attestors steps aside on phones, so `/d/*` is one row. The operator's wallet chip and Sign out take one row of their own under the logo.
- **One header (NF-03, SF-02, SF-03, MW-20):** same slots and order everywhere: logo, Attestors, the page's own control, Sign in, theme. The supplier page and operator show "Your deals" in the Sign in slot when signed in (nothing when signed out, because those pages have their own sign-in). The home hero button also becomes "Your deals" when signed in.
- **Tap targets (NF-07, NF-17):** the theme button is at least 44 px wide, header buttons are 44 px tall at every width, the language pills are 40 px, and the directory search is 44 px tall and 16 px.
- **Opening `/app/*` directly (SF-06):** a session that reads as signed out for a moment no longer bounces to sign-in; the page waits 2.5 seconds ("Checking your sign-in…") before it leaves.
- **Arbiter and role lists (RT-24):** each deal appears as soon as it is read and the "n of m" count moves one at a time. The wallet's list of deals is remembered for the visit, so a second visit paints at once while it refreshes.
- **Language (NF-10):** switching the supplier page to 中文 sets the page language to Chinese (`zh-CN`) for screen readers and translation tools, and back to English.
- **Rolling counters (NF-11):** the reel digits can no longer be selected or copied. Assistive technology already reads the real figure.
- **Home "A real deal" card and `/d/*` summary (NF-05, NF-12):** boxes are numbered 01, 02, 03 in order with no empty cell.
- **Status card (NF-02, NF-08, MW-19):** Total, Paid to you and Held in escrow each carry "USDC", span the card, and "Held" says "includes fees" so 30.15 against a 30.00 total is explained.
- **Frozen note (NF-09):** "Other parts are not affected." is neutral grey, not red.
- **Route dots (NF-13):** a disputed part is a hollow ring with a soft red edge, not a solid red dot.
- **Repeated amount (NF-14):** the "Funds locked" stamp no longer repeats the escrow amount from box 04.
- **404 wording (NF-15):** the deal wording is conditional ("If it was a deal link…") and the page is centred.
- **Text size (MW-03, NF-06):** all remaining 11.5 px text is 12 px. The home hero is 26 px under 400 px wide (MW-23).
- **Empty space on `/join` (NF-04):** two short answers (is the address safe to share, what it costs) fill the page. The cost answer says accepting a deal takes a small network fee paid from the wallet.

### Not changed, on purpose
- **"Accept as attestor" and "Connect wallet" as links (SF-04, SF-05):** both go to another page, so they stay links (anchor elements) and are announced as links. Only their look is button-like.
- **NF-18 (labelling buyer-typed names in 中文):** optional; not done.
- **MW-05:** unchanged, waits for reviewed Chinese copy.
- **Empty space on `/signin`:** content is vertically centred and the left panel has steps; more filler was not added.

### Retest checklist for batch 11
1. `/operator` signed in: Sign out returns you to the front page, signed out.
2. 320 px: `/d/284` header is one row; `/operator` is two (logo row, wallet row).
3. Header on `/`, `/attestors`, `/d/284`, `/operator` signed in: "Your deals" in the same slot.
4. `/app/arbiter`: the count moves one by one; leave and return, rows paint at once.
5. Open `/app/attestor` directly in a new tab: no bounce to `/signin` while the session is valid.
6. `/d/284` in 中文: the page language is Chinese (inspect `<html lang>`); status card has USDC on all three figures.
7. `/` live-deal card and `/d/*`: boxes numbered without gaps.

## Batch 10 — 2026-10-21 (the remaining open findings)

Web app rebuilt and restarted; no relayer or contract changes.

### Fixed
- **One header (MW-20):** the public pages, supplier page and operator page use one header component: logo, Attestors, the page's own control (the language switch on `/d/*`, the wallet chip on `/operator`), Sign in, theme. Same logo size everywhere.
- **Sign in while signed in (M-S13):** on public pages the header link reads "Your deals" (and goes to `/app`) when the browser holds a sign-in. It only looks for the token's presence; public pages still load no wallet code.
- **Frozen note once (MW-18):** each disputed part says only "Frozen until the arbiter decides." and one line above the parts says "Other parts are not affected." (also in Chinese). The held stamp already has room reserved.
- **Deal status card (MW-19):** the supplier page's summary now shows Total, Paid to you and Held in escrow (Chinese included) instead of repeating the total and the part count.
- **Record headline (MW-08):** smaller on phones, so "Funded · 3 parts in dispute" fits on fewer lines; the print button was already hidden on phones.
- **Operator explanations (MW-21):** on phones each long explanation is folded under "What this does", so the controls and status come first. Wide screens show them as before. "Connect wallet" / Sign out came in batch 8.
- **Attestor and arbiter home (RT-25):** a three-tile summary (Needs you, Waiting on others, Settled) fills the top of the page.
- **Phone tab bar (M-S09):** it appears once the role read finishes, so it no longer shows three tabs and then jumps to more.
- **Failed requests (M-S11):** a browser that cannot reach the service now says "Could not reach the Waybill service. Check your connection and try again; nothing was sent." instead of "Failed to fetch".
- **Dispute buttons (M-S06):** "Open dispute room" and "Withdraw dispute" are the same kind of button, 44 px tall on phones.
- **Create form addresses (M-S02):** a short form of the typed supplier or refund address ("0x4632…D0F1") shows under the field, because the full address is wider than the field on a phone.
- **Short addresses (M-S04):** a shortened address no longer breaks across two lines.
- **Spacing (M-S12, M-S13):** less dead space under Settings and above the footer on the attestor page.

### Not done
- **MW-05 (language toggle on public pages):** still not added. The home page, record, directory and legal pages have no Chinese text, and a toggle that changes nothing would mislead. It needs the Chinese copy for those pages written and reviewed first; the supplier page keeps its own toggle.

### Retest checklist for batch 10
1. Header on `/`, `/attestors`, `/d/284`, `/operator`: same slots and logo size. Signed in, the link reads "Your deals".
2. `/d/284`: one "Other parts are not affected." line above the parts; the status card shows Paid to you and Held in escrow (try 中文).
3. `/operator` on a phone: explanations folded; open "What this does" to read them.
4. `/app/attestor` and `/app/arbiter`: the three summary tiles.
5. `/app/attestor` on a phone: the bottom tab bar appears once and does not change.
6. Stop the relayer, then open any evidence read: the message says the service could not be reached.
7. `/app/new` on a phone: type an address and see the short form under the field.

## Batch 9 — 2026-10-21 (remaining layout and copy items)

Web app rebuilt and restarted; no relayer or contract changes.

### Fixed
- **Waybill boxes (MW-07, M-S05):** the numbered boxes are numbered in the order shown (no skipped 03). The header already carries both addresses, so the Buyer and Supplier boxes appear only when they add something (a name, or "Payout wallet not set yet"). An odd last box fills its row on phones, so there is no empty cell.
- **Attestor directory (MW-11):** a table with column headers on desktop (Signed, Upheld against, Slashed, Status, numbers right-aligned), stacked rows on phones, and a short "Who attests" note under the list.
- **Home page (MW-23):** smaller headline on phones, "Sign in" and "How it works" buttons in the first screen, and the deal-count line in the normal text face.
- **Legal page (MW-25):** the draft notice is a visible banner, and a short "On this page" link row sits under the heading.
- **File picker (M-S10):** the choose-file button is styled like the other buttons.
- **Operator logo (leftover from batch 8):** 44 px tall on phones.

### Checked and left as is
- **RT-26:** deal 280 appears in the arbiter's "needs you" list because it is a real proposed deal naming that wallet as arbiter, so it does need an accept. Not a bug.
- **MW-22:** the "How it works" steps are already four across and the rules two across at 768 px and wider.

### Still open
MW-05 (language toggle on public pages, waits for reviewed Chinese copy), MW-08, MW-18, MW-19 (needs Chinese strings), MW-20 (one shared header), MW-21 (long operator paragraphs), RT-25 (the `/app/attestor` list stays narrow and centred), M-S02 (long address clipped in the phone form), M-S04 (short addresses can break across lines), M-S06, M-S09 (tab bar shows 3 tabs, then more after the read), M-S11 (friendlier retry copy for a failed fetch), M-S12, M-S13.

### Retest checklist for batch 9
1. `/record/284`: boxes are numbered 01, 02, 03… with no gaps; no empty cell at 320 px.
2. `/attestors` at 1440 px: column headers and aligned numbers; at 375 px: stacked rows.
3. `/` at 320 px: the headline fits in four lines or fewer and the Sign in button is on the first screen.
4. `/legal`: draft banner and the three links under the heading.
5. `/app/attest/<id>` choose-file button looks like the other buttons.

## Batch 8 — 2026-10-21 (signed-in blockers, phone layout, desktop space)

Fixes for QA's retest of batches 6 and 7 (report §10) and the real-device review (report §11). Web app rebuilt and restarted. Nothing changed in the relayer or contracts.

### Signed-in blockers
- **Create deal bar behind the tab bar (M-S01):** on phones the Create bar now sits above the bottom tab bar (and the safe area), and the form has room to scroll past both. The tab bar buttons are 44 px tall.
- **Wrong-wallet box for a named attestor or arbiter (RT-19):** `/d/<id>` no longer shows "This deal is for another wallet" to a wallet that is named on the deal as an attestor or arbiter. They see only the green "You are named… Accept" box.
- **Stuck on "Preparing your wallet" (RT-20):** arriving at `/app/*` from a page with its own wallet setup now asks the wallet library to reconnect, and if no account appears within 6 seconds the page reloads once by itself. The button stays as a manual fallback.
- **Old errors after an account switch (RT-21):** the page content is rebuilt for the new account, so the previous account's error or half-filled dialog is gone.
- **Slow arbiter list (RT-24):** the list reads six deals at a time (was three) and shows deals it has already read in this visit at once. The heading says "Reading your deals… 3 of 40" until every deal is read, and "Nothing needs you today" only appears after the read completes.
- **Fund dialog numbers (RT-22):** each figure is written exactly, with no padding: "locks 20.10 … holds 1.163558".
- **Evidence read (RT-23):** the dialog says one signature opens the files of every part of the deal for 8 minutes. (The signed text is unchanged; the relayer must keep matching it.)

### Phones
- **Header at 320 px (MW-01):** "Sign in" no longer wraps; the theme button shows only its symbol under 400 px.
- **Tap targets (MW-02):** header links, Sign in, theme, Sign out, footer link, history transaction links and the Remove button are at least 44 px tall on phones.
- **Small text (MW-03):** the small caps labels, theme button, "USDC" units and similar are 12 px (were 10.5 to 11 px).
- **Input zoom on iPhone (MW-04):** every text field is 16 px on phones.
- **Public record history (MW-06):** repeated events collapse into one row with a count; time and transaction sit on separate lines on phones; the first 10 rows show and the rest open under "Show N more". "Print or save as PDF" is hidden on phones.
- **Attestor profile (MW-09, MW-10):** one column on every width: name and address, a four-across stat strip, activity summary, then the full-width history (same collapsing). Phones show a shortened address; "Not registered" is no longer in the monospace face; a same-day range shows one date.
- **Create form (M-S03):** on phones "Paid when" takes a full row and Remove is a 44 px button; the stray dash under Share is gone.
- **Operator header (M-S08):** "Connect wallet" is a real button, a connected wallet gets a Sign out button, and the chip reads "0x… · pauser / read only / checking" on one line.
- **Phone tab bar (M-S07):** the public "Attestors" link is no longer in the signed-in phone tab bar, so an attestor has five tabs, not six.

### Desktop space
- **Supplier page (MW-17):** wider (up to 1024 px). Parts sit side by side only when each has room; three or more parts stack when the page is narrower, so "HELD BY DISPUTE" and the frozen note no longer wrap into a squeeze or collide with the stamp.
- **/join (MW-12, MW-13):** uses the public header and footer, and shows a three-step "what happens next" beside the sign-in card.
- **/signin (MW-14, MW-15):** the duplicate "Waybill" eyebrow is gone, the left panel lists the three steps, the form is wider on desktop, and phones show a one-line value statement above the form.
- **404 (MW-16):** larger and lower on the page, with Home, Attestors and Sign in buttons.

### Not changed in this batch (decisions or follow-ups)
- **Language toggle on public pages (MW-05):** not added. Only the supplier page has reviewed Chinese copy; a toggle elsewhere would switch nothing. Planned with the Chinese copy review.
- **One header everywhere (MW-20):** the public pages, supplier page, sign-in and operator still have their own headers; they now share tap sizes and the theme button but not one component.
- **Open, lower priority:** MW-07 (record hero repeats the parties and skips field 03), MW-08, MW-11 (attestor list as a table), MW-18, MW-19, MW-21, MW-22, MW-23, MW-24, MW-25, RT-25 (empty space on `/app/attestor`), RT-26, M-S02, M-S04 to M-S06, M-S09 to M-S13.
- **Not provable here:** the real-device behaviours (iOS zoom, safe areas, Rabby and Privy start-up) were not run on a phone; the web build was checked with Chrome at 320, 390 and 1440 px and axe.

### Retest checklist for batch 8
1. Phone (375 px) `/app/new`: the Create deal button is fully visible above the tab bar and can be tapped; scroll to the bottom and nothing is hidden.
2. Phone 320 px, any public page: header on one line, "Sign in" not wrapped.
3. `/d/286` as the attestor wallet: only the green "You are named" box.
4. From `/d/286` tap "Accept as attestor": the attest page opens (or reloads once by itself and then opens).
5. Switch the account in Rabby on `/app/deals/286`: no red error from the previous account remains.
6. `/app/arbiter` with many deals: "Reading your deals… n of m", never "Nothing needs you today" until it has finished. Second visit shows rows at once.
7. `/record/284` on a phone: grouped history, time and transaction on separate lines, "Show N more".
8. `/attestors/<address>` at 1440 px: one column, stat strip across, history full width.
9. `/d/284` at 1440 px: the three parts sit side by side with room; at 800 px they stack.
10. `/join`, `/signin`, a missing page (`/d/abc`): the layouts described above.
11. `/operator` on a phone: Connect wallet button; after connecting, Sign out.

## Batch 7 — 2026-10-20 (slow reads, list layout, attestor page, language)

Web app and relayer restarted. axe: 0 violations on the public pages and `/operator` at 375 and 1440 px, light and dark.

### Slow reads (RT-05) — why it was slow, what changed
- **Why:** each page read the chain from the browser straight to the free public RPC (about 0.7 to 1.6 seconds per call from the test machine), in two or three steps one after the other, and every component created its own client, so a handful of open pages shared one rate limit and hit 429s. The off-chain details were also fetched before the chain read started.
- **Shared read front on the relayer (`POST /v1/rpc`):** the browser now reads the chain through the relayer first and only falls back to the public RPC if the relayer is unreachable. The relayer forwards only read methods, shares identical reads for 2 to 3 seconds, joins reads already in flight, and retries a rate-limited answer twice. Sending transactions is refused there; transactions are still signed and sent by the wallet. In a test the second identical read came back in 1 ms (the first took 0.42 s).
- **One read client per page and parallel reads:** the chain read, the public details and the history are fetched together (they used to run one after the other). One client is shared by all components so their reads merge into the same requests.
- **Less polling:** open deals refresh every 30 seconds (was 15) and not at all while the tab is hidden. After a transaction the first refresh waits about 2.6 seconds so the shared cache cannot hand back the old state.
- **Instant paint from the last read:** a deal you have already opened in this visit shows at once with *"Showing what was read a moment ago. Updating from the chain…"* and is replaced by the fresh read. Money actions are still checked against the chain before the wallet opens. The remembered read lives in memory only (gone on reload).
- **What to expect:** a first deal page should now be limited mostly by the relayer and the chain, not by the browser's own rate-limited connection. The public RPC is still the upstream, so a very slow or limited public RPC will still slow the first read of anything new. If QA still sees waits above about 10 seconds on a signed-in page, note which step (wallet start-up, list, deal) so it can be measured.

### List rows (RT-10)
- The deal lists use the empty space for the progress bar (the text column and bar column share the width), so there is no wide gap between the text and the bar.

### Attestor profile (RT-12)
- Runs of identical records collapse into one row with a count ("A statement they signed was recorded × 38", with the date range and the latest transaction), newest first. The left column also shows first activity, latest activity and the number of registry records. The registry records outcomes, not deal numbers, so a row still cannot be tied to one deal; a note says so.
- Not changed: the public header on this page shows "Sign in" even if a wallet is connected elsewhere (public pages carry no wallet code by design).

### Language (RT-17)
- The supplier page's language control is larger and labelled "文 / A". A browser set to Chinese with no saved choice sees a banner *"查看中文版本 · View this page in Chinese"*; the page is never switched without asking.

### RT-11 (first click on a deal row)
- Not reproduced. The list is now stable across refreshes (rows stay mounted and the remembered read shows at once), which was my best guess at the cause. If it still happens, please send the browser console output and the exact page.

### Retest checklist for batch 7
1. Open a deal page, go back to the list, and open it again: the second open is instant with the "Showing what was read a moment ago" line for a moment.
2. `curl -X POST <api>/v1/rpc -d '{"jsonrpc":"2.0","id":1,"method":"eth_sendRawTransaction","params":["0x00"]}'` is refused (`-32601`). `eth_chainId` answers.
3. In the browser network tab, deal pages call `<api>/v1/rpc`, not `rpc.testnet.arc.io`.
4. Stop the relayer: deal pages still load (public RPC fallback), only history/terms are missing.
5. `/app/attestor` rows at 1440 px: no wide gap before the bar. `/attestors/<address>`: grouped history.
6. A browser with Chinese as its language, fresh profile, `/d/284`: the Chinese banner.

## Batch 6 — 2026-10-20 (retest findings)

Fixes for QA's retest of batches 1 to 5 (report §8). Web app and relayer restarted. `WAYBILL_SITE_URL` is now set to the ngrok address, so `og:image` is absolute. axe: 0 violations on the public pages and `/operator` at 375 and 1440 px, light and dark.

### Errors (WB-QA-001, RT-01)
- **Request limits relayed as a decline:** a request-limit or outage error is now recognised first, even when the wallet wraps it in a rejection code. Wording such as "Request exceeds defined limit", "rate limit exceeded", "429", or codes -32005 / -32603 now gives *"The network is busy or could not be reached… try again in a moment"*. "You declined it in your wallet" appears only for a genuine rejection.
- **Declined signatures:** every signature path (evidence files, terms, dispute, label, decision, settings, share) now uses the same plain wording, never the library's "User rejected the request… Version: viem@…" text.

### Wallet account switch (RT-02, RT-03)
- When the account is switched inside the wallet app, the page reloads so the header, open dialogs and role lists belong to the new account. (Applies on `/app/*`, the supplier page and the operator header.) Anything typed but unsent is lost on a switch.

### Evidence reads (RT-04)
- The read signature is also kept for the tab (session storage, about 8 minutes, then it asks again), so a reload does not ask again. A declined signature is never kept.

### Attestor and arbiter flows (RT-06 to RT-09)
- The attest page heading shows the part's amount ("Part 1: 20.00 USDC, of a 40.00 USDC deal").
- **Acceptance banner:** a wallet named as attestor or arbiter who has not accepted sees *"You are named on deal N as … Accept as attestor / Accept as arbiter"* on `/app/deals/<id>` and `/d/<id>`, linking to the right page.
- The arbiter's room for an unaccepted deal is titled **"Invitation · deal N"** with *"You are invited to be the arbiter"*, not "Dispute room / Nothing is disputed". The arbiter home text explains acceptance first. The list row reads *"You are named here · accept your role so the deal can be funded"*.
- Part cards say *"Needs 2 attestors to confirm delivery (0 so far)"* / *"To be confirmed by 0x…"*, so signing and accepting no longer read the same. The "Accept" tag on lists is now a button-style tag, not a marker highlight.

### Chinese mode (RT-13)
- Part cards, the frozen/released footers, the confirmation line, due dates, the waybill labels (供应商, 货物, 交易总额, 条款), the units/cartons line, the fee/arbiter line and the time line are translated. "stubs" is now "parts" in English, and the footer no longer collides with the 冻结 stamp. Names, goods and cities the buyer typed stay as typed. Not translated: the private details block (shown to the signed-in supplier).

### Smaller items (RT-14, 15, 16)
- Fund dialog shows both amounts with the same decimals ("locks 20.100000 … holds 1.163558").
- The terms-read signature now says *"terms: none, this only reads"* and *"public: not applicable"* instead of dashes. **The relayer must be the matching version; it has been restarted.**
- After signing, the button reads "Reading the files…" / "Reading the details…" instead of staying on "Waiting for your wallet…".

### Not done in this batch
RT-05 (slow reads; the public RPC is the cause, a dedicated RPC is the fix), RT-10 gap in the list row, RT-11 (first click on a deal row did not navigate; could not reproduce, please send steps), RT-12 (attestor history grouping and left column), RT-17 (language toggle prominence).

### Retest checklist for batch 6
1. Cause an RPC 429 (public RPC under load) during an accept: message says network busy, not declined.
2. Decline a signature on "Show the files" and "Show the details": plain wording only.
3. Switch accounts in Rabby on `/app/deals/<id>`: the page reloads under the new account.
4. Open "Show the files", reload, open again: no second signature within 8 minutes.
5. As a named attestor open `/app/deals/<id>` and `/d/<id>`: the acceptance banner. As arbiter open `/app/room/<id>`: "Invitation".
6. `/d/284` in 中文: no English UI text except what the buyer typed.
7. Fund dialog with a low balance: amounts line up.

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

