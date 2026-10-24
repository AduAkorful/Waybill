# Waybill backend / relayer

This service is an off-chain read and gas-sponsorship process. Arc escrow
contracts remain the source of truth for deal state, balances, deadlines, and
recipient amounts. Postgres stores cursors, attempts, projections, contacts,
notifications, evidence pointers, and labelled test flags only.

## Current boundaries

- `packages/network/src/runtime-network.ts` (`@waybill/network/runtime`) is the single testnet/mainnet switch.
- `src/event-worker.ts` scans one-confirmed-block ranges and persists a
  monotonic cursor.
- `src/candidate-processor.ts` re-reads each milestone before any write.
- `src/submission.ts` can call only `claim`, `refund`, and `applyDefault` on
  the configured escrow.
- `src/nonce-manager.ts` supports one active relayer writer. Do not run
  multiple writers without a shared nonce/lease implementation.
- `src/read-model-store.ts` and `src/reconciliation.ts` are cache/diagnostic
  surfaces; neither can move funds.
- `src/notification-dispatcher.ts` and `src/evidence-storage.ts` accept
  provider interfaces. Provider SDKs and credentials are intentionally not in
  this repository.

## Migration order

Apply these migrations in numeric order:

1. `001_relayer_cursors.sql`
2. `002_relayer_attempts.sql`
3. `003_chain_read_model.sql`
4. `004_notification_outbox.sql`
5. `005_contacts_test_flags.sql`
6. `006_evidence_pointers.sql`

Use a real Postgres migration runner in deployment. Do not edit a production
database manually to make a failed cursor, projection, or attempt appear
healthy.

`src/postgres.ts` creates the pool from `WAYBILL_DATABASE_URL` and applies the
numbered migrations under a Postgres advisory lock. SSL is required by default;
set `WAYBILL_DATABASE_SSL=false` only for an explicitly isolated local
development database.

## Testnet operation

1. Copy `.env.example` into a secret-managed runtime environment.
2. Set `WAYBILL_NETWORK=testnet` and the fresh testnet deployment start block.
3. Use only the saved campaign wallets for labelled testnet UI testing.
4. Keep `WAYBILL_RELAYER_PRIVATE_KEY` separate from all user/test wallets.
5. Run module tests and a testnet smoke path before enabling continuous polling.
6. Watch health, reconciliation issues, attempt states, and relayer gas.

## Mainnet preflight

Mainnet is a separate deployment and key set. Before switching the environment:

- independently review and verify every mainnet manifest address and chain id;
- verify USDC decimals (6) and native gas decimals (18);
- verify runtime bytecode, linked libraries, constructor parameters, source
  verification, caps, and pause semantics;
- run lifecycle, dispute, timeout, blocked-recipient, replay, race, fuzz,
  invariant, and fork coverage against the exact mainnet-linked artifacts;
- set a reviewed `WAYBILL_RELAYER_START_BLOCK`;
- fund only a dedicated gas-only relayer wallet;
- never reuse testnet campaign wallets or testnet private keys;
- run reconciliation before enabling user traffic.

The application must refuse an incomplete mainnet manifest and must never
fall back to the checked-in testnet manifest.

## Read API

Set `WAYBILL_API_PORT` to serve the read-only HTTP API from the same process as the relayer and indexer; leave it empty to run the loops only. Routes: `GET /health`, `/v1/network`, `/v1/deals/:id` (live chain read with projection), `/v1/deals/:id/events` (indexed events, oldest first, with block time when known), `/v1/wallets/:address/deals`, `/v1/attestors[/:address]`, `/v1/operator` (live escrow limits, pause state, pauser, relayer gas balance, plus index aggregates: deals by state, volume by deal label, open disputes, stream cursors, recent setting changes), `/v1/arbiters` (everyone with an event on the arbiter list, with live `isAllowed`, advertised fee and any scheduled addition or removal). Browsers are served only for origins listed in `WAYBILL_API_ALLOWED_ORIGINS`. Start with `npm run start --workspace @waybill/relayer`.

The indexer fetches logs by address and decodes them itself: the public Arc RPC rejects any filter that lists about 30 or more event topics with "requested range too large", whatever the block range. Keep `WAYBILL_RELAYER_MAX_BLOCK_RANGE` at or below 5,000. Set `WAYBILL_RELAYER_START_BLOCK` to the escrow deployment block (testnet: 67900503) so the first run backfills the whole history.

## Email notifications

Opt-in: set all of `WAYBILL_EMAIL_RESEND_API_KEY`, `WAYBILL_EMAIL_FROM` and `WAYBILL_PUBLIC_WEB_URL` (where the links in mail point), or none; a partial set stops the process at start. A wallet owner sets an address with `POST /v1/contacts` (`{"email","notify"}`, signed by that wallet with `emailMessage` in `src/wallet-emails.ts`), reads it with a signed `GET /v1/contacts`, and a one-time link mailed to the address (`/verify-email?token=` in the web app, which calls `POST /v1/contacts/verify`) proves they can read the inbox. Only a verified, switched-on address is mailed; changing the address starts again unverified. When the escrow indexer stores a new event (`src/notification-planner.ts` decides who is told what: invitations, acceptances, funding, confirmation, payment, disputes and their decisions, address changes, settlement, cancellation), the people it concerns who have a verified address get a short email through the outbox (`src/event-notifier.ts`). The person who acted is not told. Events whose block is more than 48 hours old are treated as history and never mailed, so a backfill sends nothing. Mail is plain text and HTML, names the deal and part and nothing commercial, and links to the recipient's own page. The dispatcher runs in the same process every 10 seconds; failed sends are retried.

## Deal labels

`POST /v1/operator/labels` lets the escrow's **pauser** wallet mark deals as `team`, `test`, `self-dealing` or `third-party` (the first three count as test volume) so the operator console can separate volume. Body: `{"ranges": [["0","278"],["281","281"]], "label": "team"}`, with the headers `x-waybill-signer`, `x-waybill-signature`, `x-waybill-signed-at`. One wallet message signature (`labelMessage` in `src/deal-labels.ts`; the web app builds the same text) covers the label and every deal in the request, expires after 10 minutes, and the signer must equal the escrow's live `pauser()`. Deals that do not exist yet are refused; at most 10,000 deals and 100 ranges per request. The signature check is for ordinary wallets (EOAs). A label is a note in the index and changes nothing on the deal. Needs no configuration.

## Evidence upload

Deal parties (any wallet the escrow names in the deal) can store dispute and attestation evidence. It is opt-in: set
all of `WAYBILL_EVIDENCE_KEY`, `WAYBILL_EVIDENCE_S3_*` (any S3-compatible bucket: endpoint, bucket, region, access key
id, secret) and `WAYBILL_EVIDENCE_PINATA_JWT`, or none. A partial set stops the process at start.

- `POST /v1/deals/:id/evidence/:part` takes the raw file as the body. The wallet signs one message that lists every
  file digest of the batch (`evidenceMessage` in `src/evidence-auth.ts`; the browser builds the same text). Headers:
  `x-waybill-signer`, `x-waybill-signature`, `x-waybill-signed-at`, `x-waybill-files`, `x-waybill-file-name`. A
  signature binds the network, escrow, deal, part and files, expires after 10 minutes, and the signer must be a party
  of the deal as indexed from the contract.
- `GET /v1/deals/:id/evidence` lists the files, `GET /v1/deals/:id/evidence/:evidenceId` returns the original bytes,
  both signed the same way with action `read`.
- Files are encrypted with AES-256-GCM before they reach the bucket or IPFS, so both stores hold only ciphertext. The
  record keeps the SHA-256 of the original file; a download whose bytes no longer match it is refused. Losing
  `WAYBILL_EVIDENCE_KEY` makes stored evidence unreadable, so keep it in the secret store with a backup.
- On-chain, a dispute records `keccak256` of the file digests in upload order (`evidenceCommitment` in the web app).
- Limits: 10 MiB per file, 10 files per signature. Not live-tested against a real bucket or Pinata yet: the S3
  signing is checked against AWS's published test vector and both providers against fakes.
