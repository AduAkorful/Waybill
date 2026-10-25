# Data model

The relayer keeps a Postgres database. The chain is the source of truth for money and state; the database holds an index of it, bookkeeping for the relayer, and the few things that exist only offchain. Every table has a `network` column (`testnet` or `mainnet`) except `waybill_relayer_cursors` and `waybill_relayer_attempts`, which rely on schema separation instead. Each deployment uses its own schema (`WAYBILL_DATABASE_SCHEMA`; mainnet uses `waybill_mainnet`), so a new escrow starts with an empty index without deleting an old one.

Schema changes are numbered SQL files in `services/relayer/migrations/`, applied in order under a database advisory lock when the relayer starts. On every start the relayer also enables row-level security on every `waybill_*` table and removes the `anon` and `authenticated` roles' privileges on them, because Supabase exposes the `public` schema to its API.

## Indexed from the chain (rebuildable)

| Table | Purpose |
|---|---|
| `waybill_chain_events` | Every indexed event, keyed by network, block and log index: its transaction hash, name, deal and part, block time and JSON payload. Idempotent, so replays are harmless. This feeds the timeline and the alerts. |
| `waybill_deal_projections` | One row per deal: state, buyer, supplier, payout wallet, total and prepaid fee, and the chain position of the last event applied. Updates only move forward. Used for lists and for the stale-marked fallback; live reads come from the chain. |
| `waybill_deal_parties` | Every wallet a deal names and its role (`buyer`, `supplier`, `arbiter`, `panel`, `attestor`, with the part for attestors). Read from the contract when the deal is created, because an invited attestor shows up in no event until they accept. Powers `/v1/wallets/:address/deals` and evidence access. |
| `waybill_relayer_cursors` | How far each indexer loop has read, so a restart resumes where it stopped. Can only move forward. |

If the database is lost, restore a backup, or empty the schema and let the indexers re-read from the deploy block.

## Relayer bookkeeping

| Table | Purpose |
|---|---|
| `waybill_relayer_attempts` | One row per `claim`, `refund` or `applyDefault` for a deal and part: its status (`pending`, `submitted`, `success`, `reverted`), transaction hash and attempt count. A successful action is never sent again; a reverted one can be retried. |
| `waybill_notification_outbox` | Queued emails with de-duplication, leases and retries, so a restart or a provider outage neither loses nor duplicates a message. |

## Offchain-only data (authoritative here)

| Table | Purpose |
|---|---|
| `waybill_deal_terms` | What the buyer recorded about goods, units, places, names and part titles, whether it is public, and who set it. Editable only before the deal is funded. The buyer signs a digest of it, so the same hash can be checked in the browser and on the server. |
| `waybill_evidence_pointers` | For each uploaded file: the deal and part, the uploader, the SHA-256 of the original, where the encrypted copy is (object storage and IPFS), its type, size and name. The files themselves are not in Postgres. |
| `waybill_wallet_emails` | A wallet's email address, whether updates are on, when it was verified, and a hash of the pending confirmation token. The token itself is never stored. |
| `waybill_deal_flags` | The operator's label for each deal (`team`, `test`, `self-dealing`, `third-party`), so volume is not mixed. |
| `waybill_contacts` | Contact preferences by wallet and role, from an early migration. The email settings the app uses are in `waybill_wallet_emails`. |

## Not stored

Private keys of any user. Deal funds. The plain text of evidence files.

## What you can rely on

* A projection, or any list built from the index, can lag the chain. Pages that show money or state read the contract directly, and mark data from the index as possibly stale.
* The commitment recorded on chain for a dispute or an attestation is the only proof of what files were submitted. The files and their pointers can be lost; the commitment cannot be changed.
