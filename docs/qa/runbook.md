# QA runbook: running Waybill against Arc testnet

Everything here uses **test money on Arc testnet (chain 5042002)**. Nothing in this runbook touches mainnet, and no step needs a real key or a real payment method.

## 1. What you are testing

| Piece | What it is | Where |
|---|---|---|
| Web app | Next.js, talks to the chain through the user's own wallet and to the relayer over HTTP | `apps/web` |
| Relayer | Indexer, read API, evidence upload, email, gas-only worker for claim/refund/default | `services/relayer` |
| Contracts | Already deployed on testnet; do not redeploy | `contracts/` |

Contract addresses (public, from `packages/network/src/networks.ts`):

| | Address |
|---|---|
| Escrow | `0xcf08585EdCEb9b8612046b2205cf1aa2C42E5EfA` |
| ArbiterList | `0xcA46c6A2665F2A5F9b021ad256D00002144d7492` |
| AttestorRegistry | `0x5D68F4f934F49c39Ce1Be134254FAbd1AECcB225` |
| USDC (6 decimals, ERC-20 view of Arc's native USDC) | `0x3600000000000000000000000000000000000000` |
| Pauser (operator console, labels, arbiter list) | `0x4632A278FEb0a4D249561e7fC3f3708C4329D0F1` (the team holds this wallet; QA needs it for section 6 of the matrix only) |

## 2. Start the stack

If the team has deployed the QA instance (Vercel, Render, Supabase; see `docs/deploy.md`), skip this section and use the URL you were given. The steps below run the same stack on your own machine.

Prerequisites: Node 22+, bun, a Postgres 14+ database (TLS or `WAYBILL_DATABASE_SSL=false` for a local one), and a Privy app id for the web origin you will use.

```bash
npm install
```

**Relayer** (`services/relayer`, copy `.env.example` to a secret-managed env and fill it):

| Variable | Value for QA |
|---|---|
| `WAYBILL_NETWORK` | `testnet` |
| `WAYBILL_RELAYER_START_BLOCK` | `67900503` (the first run backfills history; with the public RPC this takes a while, a dedicated RPC is much faster) |
| `WAYBILL_DATABASE_URL` | your Postgres |
| `WAYBILL_API_PORT` | `3001` |
| `WAYBILL_API_ALLOWED_ORIGINS` | the web origin, exact, e.g. `http://localhost:3000` |
| `WAYBILL_RELAYER_PRIVATE_KEY` | a **new throwaway** key, used only for gas to run claims. Fund it with a little testnet USDC (gas is native USDC). It never holds deal money. |
| `WAYBILL_EVIDENCE_*` (all or none) | an S3-compatible bucket, a Pinata JWT and a 32-byte hex key. **Without these, dispute and attestation evidence cannot be uploaded** and the dispute flow cannot be fully tested. |
| `WAYBILL_EMAIL_RESEND_API_KEY`, `WAYBILL_EMAIL_FROM`, `WAYBILL_PUBLIC_WEB_URL` (all or none) | a Resend key, a verified sender, and the web origin. Without these, the email settings page answers "not switched on". |

```bash
npm run start --workspace @waybill/relayer
curl localhost:3001/health        # {"live":true,"ready":true,...}
curl localhost:3001/v1/operator   # live figures; index.cursors show how far the index has caught up
```

**Web** (`apps/web`, copy `.env.example` to `.env.local`):

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_WAYBILL_NETWORK` | `testnet` |
| `NEXT_PUBLIC_WAYBILL_API_BASE_URL` | the relayer URL, e.g. `http://localhost:3001` |
| `NEXT_PUBLIC_PRIVY_APP_ID` | a Privy app whose allowed origins include the web origin |

```bash
npm run build:web && npm run start --workspace @waybill/web   # http://localhost:3000
```

Wait until every `index.cursors` entry in `/v1/operator` is within a few blocks of `chain.head` before testing screens that list deals.

## 3. Test wallets and funds

- Each role needs its **own wallet**. Sign in with Privy (email code or an external wallet). A Privy email login creates an embedded wallet; its address is shown at `/join`.
- Fund every wallet from the Circle testnet faucet (https://faucet.circle.com, Arc Testnet, USDC; or the faucet linked from Arc’s developer docs). Gas on Arc is paid in USDC, so a wallet with no USDC cannot send any transaction, including accepting a deal.
- Roles that pay gas: buyer (create, fund, approve, dispute, refund), supplier (accept, respond), attestor (accept, submit signed attestation), arbiter (accept, decide). The relayer pays gas only for `claim`, `refund` and `applyDefault`.
- A suggested set: 1 buyer (about 30 USDC), 1 supplier, 2 attestors, 3 arbiters (only needed for panel deals), 1 stranger (not in any deal, for the negative tests). Keep each deal small: 1 to 5 USDC is plenty.

## 4. Things that make testing slow, and how to work with them

These are real contract timers. They cannot be skipped, and nothing in the app fakes time.

| Timer | Length | What to do |
|---|---|---|
| Dispute response window | 72 hours after a dispute is raised | An arbiter can only decide after it closes. Raise disputes **early** and test the rest of the flow meanwhile. Two disputes already exist (see below). |
| Arbiter decision window | chosen at creation (`Hours the arbiter has to decide`) | After it passes, anyone can apply the default outcome. |
| Approved-arbiter list changes | 48 hours | Adding or removing an arbiter is scheduled, then executed after the delay. Two extra arbiters are already scheduled (see below). |
| Payout and refund address changes | 48 hours | Propose, then apply after the delay; the other side can reject meanwhile. |
| Part due date, grace period, buyer review window | set per part in the builder | Use short values for testing: due in 1 day, grace 0, review 0 to 1 hours. |
| Acceptance deadline | 1 to 90 days | A deal nobody accepted in time expires. |

**Existing real disputes (testnet, test money, ~1 USDC each):**
- Deal **281**: buyer disputed part 1; the supplier has not responded. Decidable from **2026-10-23 11:38 UTC**.
- Deal **283**: buyer disputed part 1; the supplier responded and both sides appended evidence. Decidable from **2026-10-23 11:40 UTC**.
- The wallets for these are the team's campaign wallets; QA cannot sign for them. Use them only to *view* the dispute room (`/record/281`, `/record/283`), or create your own disputes with your own wallets.

**Approved arbiters:** only `0x5EAf…460e` is on the list now. `0xd173…1EB3` and `0xD77c…8BC1` become addable after about **2026-10-20 21:27 UTC**; the pauser then executes the addition from the operator console (`/operator`, "Approved arbiters"). A three-member panel needs three approved arbiters, so panel tests start after that.

## 5. What is deliberately not built, so it is not a bug

- No fiat on/off-ramps, no bank or card payments.
- The Chinese text on the supplier page is an unreviewed draft.
- The legal page is a draft summary pending counsel.
- Mainnet is not configured and must stay unconfigured.
- Financing and bond vaults have contract support but no screens.

## 6. Reporting

Give each finding: the URL, the wallet role, the deal number, the exact steps, what you expected, what happened, and (for a transaction) the explorer link of the hash. Never paste a private key, seed phrase, evidence file, or an email verification link into a report.
