# API

The relayer serves a small HTTP API. It is the same API the web app uses. Reads are public; anything that stores data or reads private data needs a signature from a wallet. **No route sends a transaction**: every on-chain action is signed and sent by the user's own wallet.

Base URL for the production deployment: `https://waybill-relayer.onrender.com`.

## Conventions

* JSON in and out. Large numbers (amounts, block numbers, deal ids) are decimal strings.
* Errors are `{ "error": "<code>" }` with an HTTP status.
* **CORS.** Browsers are served only for origins in the relayer's allowed list (exact origins, no wildcard). Other origins get 403. Requests with no `Origin` header (servers, scripts) are not affected.
* Any method not listed for a route returns 405.
* A route that depends on a service that is not configured returns 503.

## Public reads (GET)

| Route | Returns |
|---|---|
| `/health` | `{ live, ready, components: [{ name, required, ok, detail }] }`. The components are the RPC (with the head block it sees) and the database. |
| `/v1/network` | The network (`testnet` or `mainnet`), which optional features are on (`email`, `evidence`), and the block the index starts from. |
| `/v1/deals/:id` | A deal read live from the escrow, with its indexed context. 404 `deal_not_found` for an id that does not exist; 503 if the chain cannot be read. |
| `/v1/deals/:id/events` | The deal's indexed events, oldest first, each with its transaction hash, block and block time. |
| `/v1/wallets/:address/deals` | Every deal that names the wallet, newest first, with the roles it holds in each. |
| `/v1/arbiters` | The arbiters on the approved list, their advertised fees, and any scheduled addition or removal. |
| `/v1/attestors` | Every attestor with a registry event, with live status and counts. |
| `/v1/attestors/:address` | One attestor: status, counts, profile, any pending status change, and registry history. 404 `unknown_attestor`. |
| `/v1/operator` | The operator summary: deal count, money held against the caps, pause state, pauser and treasury, the relayer's address and gas, the chain head, deals by state, volume by label, open disputes, each indexer's cursor, and recent operator changes. A failed chain read fails the whole summary. |

## Read-only chain front: `POST /v1/rpc`

A JSON-RPC endpoint for reads, so many browsers share one upstream RPC instead of each using the public one. Only these methods are forwarded: `eth_call`, `eth_blockNumber`, `eth_getBlockByNumber`, `eth_getBalance`, `eth_chainId`, `eth_getTransactionReceipt`, `eth_getTransactionByHash`, `eth_estimateGas`, `eth_getTransactionCount`, `eth_gasPrice`, `eth_maxPriorityFeePerGas`, `eth_feeHistory` and `eth_getCode`. Sending a transaction, `eth_getLogs` and `eth_getStorageAt` are refused.

* Identical reads in a short window share one upstream call. Reads pinned to a block are cached longer than reads of the latest block.
* Body up to 64 KiB, batches up to 32 calls.
* Each client has a budget per minute (default 1,200 calls; `eth_estimateGas` and `eth_getTransactionCount` count 5). Over budget: 429 `rate_limited` with `retry-after: 30`.

## Signed requests

Routes that touch private data need three headers from a wallet that is a party to the deal (or from the wallet itself, for contacts). Evidence routes add a fourth:

| Header | Value |
|---|---|
| `x-waybill-signer` | The wallet address |
| `x-waybill-signature` | A `personal_sign` signature of the message below |
| `x-waybill-signed-at` | Unix seconds when it was signed. Accepted within 10 minutes of the relayer's clock. |
| `x-waybill-files` | For evidence: comma-separated SHA-256 digests of the files the signature covers |

The message for evidence is exactly:

```
Waybill evidence
action: upload | read
network: mainnet
chain: 5042
escrow: 0x8a13ff4fbfbd67ce10e1fd015bd4a8de3179c5ff
deal: 12
part: 2 (index 1)
files: 0x…,0x…
signed: 1792800000
```

so a signature cannot be reused for another deal, part, file list or network. Missing headers return 401 `missing_signature`.

## Evidence

Available when the relayer has storage configured (check `GET /v1/evidence/health`, which returns 200 or 503).

| Route | What it does |
|---|---|
| `POST /v1/deals/:id/evidence/:part` | Uploads one file (body is the raw bytes, `content-type` is its MIME type, optional `x-waybill-file-name`). The signature's `x-waybill-files` must include the file's digest. The relayer encrypts it (AES-256-GCM), stores the ciphertext in object storage and on IPFS, and records a pointer. Returns 201. Up to 10 MiB per file, up to 10 digests per signature. |
| `GET /v1/deals/:id/evidence` | Lists the deal's evidence pointers, for a signed party. |
| `GET /v1/deals/:id/evidence/:fileId` | Downloads one file's original bytes, for a signed party. The relayer refuses a file whose digest no longer matches. |

The signer must be a party indexed from the contract (buyer, supplier, arbiter, panel member, or an attestor of that deal). A stranger gets 403.

## Deal terms

Off-chain details the buyer records (goods, units, places, names, part titles).

| Route | What it does |
|---|---|
| `GET /v1/deals/:id/terms?public=1` | The public terms, or `{ "terms": null }`. Needs no signature. |
| `GET /v1/deals/:id/terms` | The terms for a signed party. 404 `no_terms` if none. |
| `POST /v1/deals/:id/terms` | Body `{ "terms": {...}, "public": boolean }`, signed by the buyer. Refused with 409 `deal_locked` once the deal is funded, because the terms are then what the others agreed to. |

## Contacts

A wallet's own email settings. Available only when the relayer has a mail provider configured.

| Route | What it does |
|---|---|
| `GET /v1/contacts` | The wallet's email settings, signed by that wallet. |
| `POST /v1/contacts` | Body `{ "email", "notify" }`, signed by the wallet. Sends a confirmation link; nothing is mailed until it is confirmed. |
| `POST /v1/contacts/verify` | Body `{ "token" }` from the mailed link. |

## Operator

| Route | What it does |
|---|---|
| `POST /v1/operator/labels` | Body `{ "ranges": [[from, to], ...], "label": "team" | "test" | "self-dealing" | "third-party" }`, signed by the escrow's current pauser. Labels deals so volume of the team's own can be told apart from third parties'. The first three labels count as test volume. |

## Errors worth knowing

`invalid_request_url`, `invalid_deal_id`, `invalid_address` (400); `missing_signature` (401); `rate_limited` (429); `not_found`, `deal_not_found`, `unknown_attestor`, `no_terms` (404); `evidence_unavailable`, `email_unavailable`, `labels_unavailable`, `terms_unavailable`, `rpc_unavailable`, `chain_read_unavailable` (503).
