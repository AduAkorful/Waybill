# Operations

Running, configuring and watching a Waybill deployment. This page is for the operator. It names every setting but contains no secrets, and none should ever be added to the repository.

## What runs where

| Piece | Where | Notes |
|---|---|---|
| Contracts | Arc mainnet (chain 5042) | See [Contracts](reference/contracts.md). Not upgradeable. |
| Relayer | Render web service `waybill-relayer`, Starter plan, one instance | Always on. Defined in `render.yaml`. Two instances would race on one gas wallet, so keep `numInstances: 1`. |
| Web app | Vercel project `waybill`, root directory `apps/web`, Hobby plan | Production domain `usewaybill.vercel.app`. |
| Database | Supabase Postgres | Relayer schema `waybill_mainnet`. Session-pooler connection with a CA certificate. |
| Evidence files | S3-compatible object storage (Supabase Storage) and IPFS (Pinata) | Encrypted before storage. |
| Alerts | A webhook (Discord or Slack) and/or email through Resend | The relayer refuses to start on mainnet without one. |

## Requirements for local work

| Tool | Version |
|---|---|
| Node.js | 22 |
| Bun | 1.4 (runs the relayer and its tests) |
| Foundry | `forge`; the solc version is pinned in `contracts/foundry.toml` |

```bash
npm install
npm test                  # network package, relayer and web tests
npm run typecheck
npm run dev:web           # http://localhost:3000
cd contracts && forge test
```

To run the relayer locally against a network, set the settings below in `services/relayer/.env` (see `.env.example`) and run `bun src/main.ts` from `services/relayer`. Use the testnet unless you mean to use mainnet.

## Settings

### Relayer

Set in Render's dashboard. Values marked secret are never in git.

| Setting | Purpose |
|---|---|
| `WAYBILL_NETWORK` | `mainnet` or `testnet`. There is no default. |
| `WAYBILL_MAINNET_RPC_URL` | Secret. The RPC the relayer reads and sends through. It may be a dedicated keyed RPC. The relayer checks at start that it serves the manifest's chain id, and stops if not. Contract addresses are never set here; they come from `packages/network/src/networks.ts`. |
| `WAYBILL_RELAYER_START_BLOCK` | First block to index. For mainnet, the escrow's deploy block, 27,636,004. |
| `WAYBILL_RELAYER_POLL_INTERVAL_MS`, `WAYBILL_RELAYER_MAX_BLOCK_RANGE` | How often to poll and how many blocks per read. |
| `WAYBILL_RELAYER_PRIVATE_KEY` | Secret. The gas-only wallet. It holds no deal money. Keep a small balance in it. |
| `WAYBILL_DATABASE_URL`, `WAYBILL_DATABASE_CA` | Secret. Supabase session-pooler URL and its CA certificate as one line of PEM text with `\n` for newlines. |
| `WAYBILL_DATABASE_SCHEMA` | The deployment's own schema (`waybill_mainnet`). |
| `WAYBILL_DATABASE_POOL_SIZE` | Connection pool size. |
| `WAYBILL_API_PORT` | Port for the HTTP API. On Render it must equal `PORT` (10000). |
| `WAYBILL_API_ALLOWED_ORIGINS` | Exact browser origins allowed to call the API, comma-separated: the production domain and any alternative domain. No wildcard. |
| `WAYBILL_PUBLIC_WEB_URL` | The site's public address, used in email links. |
| `WAYBILL_RPC_RATE_PER_MINUTE`, `WAYBILL_API_PROXY_HOPS` | Per-client budget for the read front (default 1,200) and the number of proxies in front of the API (Render: 1). |
| `WAYBILL_EVIDENCE_KEY` and the `WAYBILL_EVIDENCE_S3_*` and `WAYBILL_EVIDENCE_PINATA_JWT` settings | Secret. Evidence storage. Set all or none. **The key encrypts every file. If it is lost the files cannot be read: keep an offline copy.** |
| `WAYBILL_EMAIL_RESEND_API_KEY`, `WAYBILL_EMAIL_FROM` (with `WAYBILL_PUBLIC_WEB_URL`) | Secret. Email updates to users. Set all or none; off when unset. |
| `WAYBILL_ALERT_WEBHOOK_URL`, `WAYBILL_ALERT_EMAIL` | Secret. Where operator alerts go. Email alerts also need the Resend settings above. At least one is required on mainnet. |
| `WAYBILL_ALERT_MIN_GAS_USDC` | Alert when the relayer wallet falls below this, in USDC (default 5; this deployment uses 0.5, because a claim or refund costs about 0.002 to 0.005 USDC). |
| `WAYBILL_ALERT_MAX_LAG_BLOCKS` | Alert when an indexer loop is this far behind (default 1,200). |
| `WAYBILL_ALERT_LOCKED_PERCENT` | Alert when money held reaches this percentage of the total limit (default 80). |
| `WAYBILL_ALERT_POLL_SECONDS` | How often the checks run (default 60). |

### Web app

| Setting | Purpose |
|---|---|
| `NEXT_PUBLIC_WAYBILL_NETWORK` | `mainnet` or `testnet`. No default. |
| `NEXT_PUBLIC_WAYBILL_API_BASE_URL` | The relayer's address. |
| `NEXT_PUBLIC_PRIVY_APP_ID` | The Privy application. The production domain must be in that app's allowed origins or sign-in fails. |
| `WAYBILL_SITE_URL` | The site's own address, used for link previews. |

Leave the `NEXT_PUBLIC_WAYBILL_MAINNET_*` addresses unset. If set, they must match the manifest, and the app will not load if they differ. A hosted build refuses the local-fork flag.

Variables prefixed `NEXT_PUBLIC_` are baked into the build: redeploy after changing one.

## Health

* `GET /health` on the relayer reports `ready` when its RPC and database are both reachable.
* `GET /v1/operator` and the operator console (`/operator`) show the deal count, money held against the limits, the pause state, the relayer's gas balance, and how far behind each indexer loop is.
* After a deploy, check that the four loops (`escrow-indexer`, `escrow-relayer`, `registry-indexer`, `arbiter-indexer`) are within a few blocks of the head.

## Operator actions

The pauser wallet can sign these from the operator console, or with `cast send` against the contracts. Nothing here can touch money in a deal.

| Action | Function | Delay |
|---|---|---|
| Stop or resume new deals | `pauseNewDeals()` / `unpauseNewDeals()` on the escrow | none |
| Lower the limits | `lowerCaps(maxDeal, maxLocked)` (raw 6-decimal units, never raising either) | none; cancels a scheduled raise |
| Raise the limits | `scheduleRaiseCaps(maxDeal, maxLocked)`, then `executeRaiseCaps()` | 48 hours |
| Change the fee treasury | `scheduleSetTreasury(address)`, then `executeSetTreasury()` | 48 hours; new deals only |
| Change the allowed fee range | `scheduleSetFeeBpsRange(min, max)`, then `executeSetFeeBpsRange()` | 48 hours; new deals only |
| Add or remove an arbiter | `scheduleAddArbiter(address, fee)` / `scheduleRemoveArbiter(address)`, then `executeAddArbiter` / `executeRemoveArbiter` on the ArbiterList | 48 hours; new deals only |
| Registry writers | `addWriter` / `removeWriter` on the AttestorRegistry | none |
| Attestor status | `scheduleSetStatus`, `executeSetStatus`, `cancelAutoSuspension` on the registry | 48 hours |
| Label deals | The console's label card (a signed request to the relayer) | none |

Example, lowering the limits to 500 and 5,000 USDC:

```bash
cast send <escrow> "lowerCaps(uint256,uint256)" 500000000 5000000000 \
  --rpc-url https://rpc.mainnet.arc.io --account <keystore-name>
```

Every one of these raises an alert, so the channel should show exactly what you did and nothing else.

## Alerts

Alerts post to the configured webhook and email, and are logged. A condition that starts alerts once, repeats every 6 hours while it lasts, and posts "Resolved" when it clears. Indexer-lag alerts wait 10 minutes after a restart while the loops catch up.

| Alert | What it means | What to do |
|---|---|---|
| **Relayer is low on gas** (critical) | The relayer wallet is below the threshold. Claims and refunds will stop being sent for people (they can still send them). | Send USDC to the wallet address in the alert. A couple of USDC lasts for hundreds of transactions. |
| **`<loop>` is behind the chain** (warning) | An indexer loop has fallen behind or never started. | Check the relayer logs and that the RPC answers. A restart resumes from the stored cursor. If it never clears, check the RPC's rate limits. |
| **Money held is close to the total limit** (warning) | The escrow holds this much of the 10,000 USDC limit. New deals will be refused at the limit. | Schedule a raise if intended; otherwise nothing. |
| **A payout to a supplier failed** / **A refund to a buyer failed** (critical) | A transfer was refused, usually because the recipient is blocked by the token. The part stays payable. | Contact the party. They can propose a new wallet, which takes effect after 48 hours, after which anyone can retry the payout or refund. |
| **Alert monitor cannot read the chain or database** (warning) | The relayer cannot read its RPC or database. | Check the RPC provider and Supabase. |
| **Any operator action** (limits, pause, treasury, fee range, arbiter list, registry writer) | The pauser did something. | Confirm it was you. If not, treat the key as compromised: see below. |

### If the operator key is compromised

The operator account is fixed in every contract, so it cannot be rotated. An attacker with it cannot touch money in a funded deal, but can stop new deals, lower limits, and schedule changes that take 48 hours to apply. Stop pointing users at this escrow (take the site offline or show a notice), deploy a replacement with a new operator, and move the site to it. Deals already funded keep working on the old contract: anyone can still send claims, refunds, defaults and decisions to it.

## Rollback

There is no rollback of escrowed funds, by design.

| Problem | Action |
|---|---|
| Bug suspected in the escrow | Pause new deals. Existing deals keep their claim, refund, dispute and default paths and nobody can move their funds. Publish a notice; ship a fix as a new deployment after review. |
| Relayer down or out of gas | Every relayer action is open to everyone, and the app offers it to the parties. Refill gas or redeploy the relayer; it resumes from its cursors. |
| Web broken | Redeploy the previous build on Vercel. |
| Database lost | Restore a backup, or empty the schema and let the indexers re-read from the deploy block. Terms, evidence pointers and email settings exist only in the database, so they need the backup. |
| Evidence key lost | The files cannot be read again. The commitments on chain are unaffected. |
| Wrong address in the manifest | Take the web offline, fix `networks.ts`, redeploy. The build and the relayer check addresses against it, and the relayer checks the chain id at start. |

## Deploying changes

* **Web:** push to `master`; Vercel builds from `apps/web`. Add the `NEXT_PUBLIC_` settings first, because they are fixed at build time.
* **Relayer:** Render's `autoDeploy` is off. Trigger a deploy from Render's dashboard, or with the Render CLI, after pushing. Its settings live in the dashboard; `render.yaml` records their intended values.
* **Contracts:** a change is a new deployment. See [Mainnet deployment](mainnet-deploy.md).
