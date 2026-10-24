# Waybill backend / relayer

This service is an off-chain read and gas-sponsorship process. Arc escrow
contracts remain the source of truth for deal state, balances, deadlines, and
recipient amounts. Postgres stores cursors, attempts, projections, contacts,
notifications, evidence pointers, and labelled test flags only.

## Current boundaries

- `config/runtime-network.ts` is the single testnet/mainnet switch.
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
