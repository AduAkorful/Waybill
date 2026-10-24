# QA test matrix

Read `runbook.md` first (stack, wallets, funds, timers). Roles: **B** buyer, **S** supplier, **A** attestor, **R** arbiter, **P** pauser (team wallet), **X** stranger (named in no deal). "Part" is what the contract calls a milestone or tranche; the app says "part" or "stub". Amounts are USDC.

Pass means: the screen states the outcome plainly, the explorer link of the transaction opens, and a refresh shows the same state from the chain. A transaction hash alone is never a pass: the app must wait for confirmation before it says "confirmed".

## 1. Sign-in, roles, navigation

| # | Steps | Expected |
|---|---|---|
| 1.1 | Open `/app` signed out | Redirects to `/signin` |
| 1.2 | Sign in with email code | Lands in the app; a wallet address is shown; `/join` shows the same address and a copy button |
| 1.3 | Sign in with an external wallet on the wrong network | "Switch to Arc" prompt; no signing surface is shown until the chain is right |
| 1.4 | Fresh wallet with no deals opens `/app` | An empty state with "New deal"; no role tabs invented |
| 1.5 | Wallet that is buyer in one deal and attestor in another | Both role tabs shown; each lists only its own deals |
| 1.6 | Switch light/dark/auto; reload | Choice is kept; Privy dialog follows the theme |
| 1.7 | Sign out | Returns to signed-out state; `/app` redirects again |

## 2. Deal builder (B)

| # | Steps | Expected |
|---|---|---|
| 2.1 | Pick each template; change parts | Shares must total exactly 100%; the summary shows the exact amount to lock and the fee |
| 2.2 | Enter a fee outside the on-chain range | Create is disabled with the reason; the range comes from the contract |
| 2.3 | Total above the per-deal or escrow cap | Disabled with the cap reason |
| 2.4 | Supplier = your own wallet; arbiter = you; attestor = arbiter | Each is refused with its own message |
| 2.5 | Arbiter not on the approved list | "Not on the approved list"; the picker lists only approved arbiters |
| 2.6 | One part with an attestation condition and 2 attestors | Create succeeds; both attestors must accept before funding |
| 2.7 | Fill the optional details (goods, places, names, part titles) and create | After creation "Save the details" asks one free signature; saved details appear on the deal page |
| 2.8 | Tick "Show these details on the public record" | `/record/<id>` shows them without signing in; unticked, `/record/<id>` shows none |
| 2.9 | Choose "A panel of three" with three approved arbiters (after they are added) | Create succeeds; acceptances show three panel rows |
| 2.10 | Panel with a duplicate wallet, the buyer, the supplier, or an attestor on it | Each refused before signing |
| 2.11 | Create, then reject the wallet prompt | Plain "you declined" message with a retry; no deal appears |
| 2.12 | Reload on the share screen | The deal exists at `/app/deals/<id>`; the share link `/d/<id>` works |

## 3. Supplier link and acceptance (S)

| # | Steps | Expected |
|---|---|---|
| 3.1 | Open `/d/<id>` signed out (phone width) | Terms, total and part tracker are visible without signing in; English/中文 toggle works |
| 3.2 | Click "Sign in to accept" | The sign-in dialog opens on the first click |
| 3.3 | Sign in with a wallet that is not the named supplier | "This deal is for another wallet" with sign out; no accept button |
| 3.4 | Sign in as the named supplier; leave the payout field empty; accept | Payout defaults to the signed-in wallet; confirmation after the receipt |
| 3.5 | Accept with a pasted payout address | The address shown in the confirmation is the pasted one |
| 3.6 | Paste an invalid address | Accept is disabled |
| 3.7 | Open `/d/<id>` for an expired deal | "Expired" banner; no accept |
| 3.8 | Returning supplier (already signed in) opens `/d/<id>` | Actions appear without clicking sign in |
| 3.9 | `/d/999999` and `/d/abc` | A clear not-found message, not a crash |

## 4. Attestor (A)

| # | Steps | Expected |
|---|---|---|
| 4.1 | Open `/app/attestor` as the named wallet | The deal shows "Accept" |
| 4.2 | Accept with and without declaring a conflict of interest | Declared conflict is stored with the deal's files; accept confirms after the receipt |
| 4.3 | After funding: choose files and notes, then sign | One wallet message signs the upload, then an EIP-712 attestation is signed and submitted; the part moves to in-review (or claimable if no review window) |
| 4.4 | Submit with no files | Blocked with the reason |
| 4.5 | Sign twice for the same part | Second attempt refused; no duplicate |
| 4.6 | Two attestors on one part (threshold 2) | Part moves on only after the second signature |
| 4.7 | Fees page after a paid part | Balance shown; withdraw moves it to the wallet |
| 4.8 | Profile page: save name and city | Appears in `/attestors` and the profile page after confirmation |

## 5. Funding and payout (B, S, A, R)

| # | Steps | Expected |
|---|---|---|
| 5.1 | Deal not yet accepted by all | Fund is not offered; the missing acceptances are listed |
| 5.2 | All accepted; Fund | If the allowance is short a USDC approval step comes first; then fund; ledger shows "held in escrow" |
| 5.3 | Fund with too little USDC | A readable "not enough USDC" message; nothing is sent |
| 5.4 | Attestation part: attestor signs, review window runs | Buyer sees "Review"; Approve pays the supplier immediately |
| 5.5 | Let the review window pass | The relayer's claim pays the supplier; no click needed |
| 5.6 | Timed part reaching its due date | Supplier is paid by the relayer after the deadline |
| 5.7 | Part never confirmed by its due date plus grace | Buyer sees "Refund"; refund returns principal and fee share |
| 5.8 | Cancel before funding | Deal shows cancelled; nothing was locked |
| 5.9 | Every part resolved | Deal shows settled; ledger totals match the explorer |
| 5.10 | Reject a wallet prompt at each step; reload mid-flight | A retry is offered; the app never claims success without a confirmed receipt |
| 5.11 | Unknown outcome (close the tab right after sending) | On return the deal page shows the real state; "Check again" re-reads, and there is no resend button |

## 6. Disputes (B, S, R; P for 6.9)

| # | Steps | Expected |
|---|---|---|
| 6.1 | Buyer opens Dispute on an in-review part, enters a reason and a file | One signature stores the files first, then the dispute transaction is sent; the part is "held by dispute" |
| 6.2 | Evidence storage not configured | Dispute is refused with "evidence storage is not set up"; nothing is sent |
| 6.3 | Supplier opens the room (`/app/room/<id>`) | Sees the buyer's files, both clocks, and "Respond" |
| 6.4 | Supplier responds with a file | Response recorded; "Filed" shown |
| 6.5 | Either side appends evidence | New file listed; original bytes download and match the stored hash |
| 6.6 | Buyer withdraws their own dispute | Part returns to its normal path |
| 6.7 | Supplier disputes an overdue part inside its grace window | Allowed; shown as raised by the supplier |
| 6.8 | Arbiter opens the room during the response window | "Decide from <time>"; no decision buttons |
| 6.9 | After the response window: arbiter decides release, refund, then a 60/40 split on three disputes | Reasoning is stored first; each outcome pays exactly as stated; the split previews the amounts and never creates or loses a unit |
| 6.10 | Arbiter misses the decision window | "Apply the default" appears for any party; buyer-raised refunds to buyer, supplier-raised pays supplier |
| 6.11 | Stranger opens `/app/room/<id>` | "This wallet is not named in the deal" |
| 6.12 | Panel deal: member votes before the response window closes | Refused; after it closes, the first vote is recorded and the part stays open |
| 6.13 | Panel deal: second member votes the same way | The part is decided at once; the third member sees it decided |
| 6.14 | Panel deal: two different votes, then a third matching one | Decided by the matching pair |
| 6.15 | Panel member votes twice | Second vote refused ("You voted: ...") |
| 6.16 | Arbiter fees page after deciding in time | Fee balance shown; withdrawing moves it |

## 7. Address changes (B, S)

| # | Steps | Expected |
|---|---|---|
| 7.1 | Supplier proposes a new payout address on a funded deal | Shown to both with the earliest apply time (48 h) |
| 7.2 | Buyer rejects it | Proposal disappears; payout address unchanged |
| 7.3 | Nobody rejects; after 48 h anyone applies | Address changes; later payouts go to it |
| 7.4 | Buyer proposes a new refund address; supplier rejects | Mirror of 7.1 and 7.2 |
| 7.5 | Apply before 48 h | Refused with the time remaining |

## 8. Email settings (any role)

Needs the email variables in the runbook.

| # | Steps | Expected |
|---|---|---|
| 8.1 | `/app/settings`, "Show my email settings" | One free signature; "no email yet" form |
| 8.2 | Save an address | A confirmation email arrives; the page says "waiting for confirmation" |
| 8.3 | Create a deal naming this wallet before confirming | No email arrives |
| 8.4 | Open the link, press "Confirm my email" | "Your email is confirmed" |
| 8.5 | Open the same link again | "expired or already used" |
| 8.6 | After confirming, trigger events (invited, funded, dispute) | One short email each, to the right people only, linking to the right page for their role; the person who acted gets none |
| 8.7 | Turn updates off and save | No further email |
| 8.8 | Change to another address | Unverified again until confirmed |
| 8.9 | Email provider not configured | Settings answers "not switched on"; the rest of the app is unaffected |

## 9. Public pages (no sign-in)

| # | Steps | Expected |
|---|---|---|
| 9.1 | `/` | Front page; the live deal count and example deal are real |
| 9.2 | `/attestors`, `/attestors/<address>` | Directory with search; profile shows registry counts and history; unknown address is a 404 |
| 9.3 | `/record/<id>` for an unfunded deal | "Isn't public yet" and no deal terms |
| 9.4 | `/record/<id>` for a funded deal; `/record/<id>/print` | Record with history and explorer links; print view is white and prints cleanly |
| 9.5 | `/record/999999`, `/record/abc` | 404 |
| 9.6 | `/legal` | Draft terms, privacy and security text |
| 9.7 | Share a `/d/<id>` or `/record/<id>` link in a chat app | A preview with the deal title |

## 10. Operator console (P only; others see read-only)

| # | Steps | Expected |
|---|---|---|
| 10.1 | `/operator` signed out or as X | Read-only monitor; no controls, with a note naming the pauser wallet |
| 10.2 | Check figures against the explorer | Escrow balance, deals created, caps, relayer gas match |
| 10.3 | As P: Pause new deals | Create and fund are refused with a pause message for everyone; claims, refunds, disputes and decisions on existing deals still work |
| 10.4 | As P: Resume | New deals work again |
| 10.5 | As P: label deals `0-N` as `self-dealing`; then `third-party` for one deal | Volume table regroups; a different wallet is refused |
| 10.6 | As P: schedule adding an arbiter | Shown with the time it can be executed; "Add now" disabled until then |
| 10.7 | As P after the delay: Add now | The arbiter appears in the builder picker |
| 10.8 | Stop the relayer; reload | The health card shows the failing components and the lag; the app does not show stale numbers as fresh |

## 11. Accessibility and layout

| # | Steps | Expected |
|---|---|---|
| 11.1 | Every page at 375 px and 1440 px | No horizontal scroll; tap targets usable |
| 11.2 | Keyboard only through builder, a dialog and a transaction flow | Focus is trapped in dialogs and returns on close; Escape closes unless a transaction is in flight |
| 11.3 | Screen reader on a transaction flow | State changes (sent, confirmed, rejected, unknown) are announced |
| 11.4 | Reduced-motion setting on | No stub-tearing or counter animation |
| 11.5 | Run axe on each page | No serious or critical findings (public pages were clean at last check) |

## 12. Security and failure checks

| # | Steps | Expected |
|---|---|---|
| 12.1 | Call the relayer API write routes without a signature | 401; a signature for one deal, label, or email cannot be replayed for another |
| 12.2 | Evidence download by a stranger | Refused |
| 12.3 | Terms set by a non-buyer, or after funding | Refused |
| 12.4 | Browser origin not in the allowed list calls the API | 403 |
| 12.5 | The app never asks for a seed phrase, private key or password | Confirm on every screen |
| 12.6 | Relayer API down | App shows "could not be read" states; amounts are never invented |
| 12.7 | Wrong network selected in the wallet mid-flow | Signing is blocked with a switch prompt |
| 12.8 | Console check on each page | No errors; any `[Report Only]` CSP messages are worth reporting |
