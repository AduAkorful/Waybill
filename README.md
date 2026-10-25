# Waybill

Non-custodial USDC escrow on Arc. A buyer locks USDC for an order, and an overseas supplier is paid in stages as named attestors confirm each one. No operator can move, freeze or redirect money held in a deal.

**Status:** live on Arc mainnet in early access (deals up to 1,000 USDC, at most 10,000 USDC held in total), and on Arc testnet. The contracts have not had an independent audit.

**App:** [usewaybill.vercel.app](https://usewaybill.vercel.app) · **Documentation:** [docs/](docs/README.md) · **Contracts and addresses:** [docs/reference/contracts.md](docs/reference/contracts.md)

## What it does

A buyer splits an order into up to eight parts, for example a deposit, production and delivery. For each part they name what releases it: attestors who sign a short statement (an inspector, a forwarder), their own approval, or a due date. The supplier, every attestor and the arbiter accept before any money moves. The buyer then locks the full amount in the escrow contract, and each part is paid to the supplier as its condition is met.

If a part is contested, the buyer or supplier disputes it. That freezes only that part, and a named arbiter (or a panel of three) decides where it goes: to the supplier, back to the buyer, or split. If nobody decides in time, a default applies. Parts that are not confirmed by their due date become refundable.

Waybill is a business tool. It is not a bank, a custodian or a lender, and it does not inspect goods: attestors sign statements and Waybill checks the signatures, not the goods.

## Properties the contracts enforce

* **Non-custodial.** The escrow contract holds the money. No function lets anyone send a deal's funds to an address of their choosing.
* **Immutable.** The contracts are not upgradeable. A new version is a new deployment.
* **Everyone agrees first.** Nothing is locked until the supplier, the attestors and the arbiter have accepted.
* **Open execution.** Anyone can send a payment, a refund or a default once it is due. The relayer does it by default and pays the gas, but nothing depends on it.
* **A pause stops only new deals.** Claims, refunds, disputes and decisions on funded deals always work.
* **Delayed changes.** The operator wallet can lower the limits at once. Raising them, changing the fee range, the treasury or the arbiter list waits behind a public 48-hour delay and affects only new deals.
* **Safe against a blocked wallet.** A failed USDC transfer leaves the part payable and retryable instead of failing the deal. Payout and refund wallets change only through a 48-hour proposal the other side can reject.

The full list, with how each one is enforced and the known limits, is in the [security model](docs/reference/security.md).

## Contracts

Five contracts on Arc, written in Solidity 0.8.28 with Foundry and OpenZeppelin v5. Source is verified on Sourcify.

| Contract | Role |
|---|---|
| `WaybillEscrow` | Holds deal funds; runs the deal and part state machines; verifies attestations; pays out, refunds and accrues fees. Its logic sits in six linked libraries. |
| `ArbiterList` | The approved arbiters for new deals. |
| `AttestorRegistry` | Each attestor's signed, upheld and slashed counts, status and public profile. |
| `BondVault` | Optional attestor bonds that an arbiter can penalise. |
| `FinancingVault` | Lenders and supplier loans against funded deals. |

Arc mainnet (chain 5042), escrow: `0x8a13ff4FbfBd67cE10e1Fd015bD4a8De3179C5ff`. Every address, for both networks, is in [docs/reference/contracts.md](docs/reference/contracts.md).

## How the pieces fit

```
 Browser ──sign──▶ User's wallet ──transactions──▶ Arc (escrow, registries)
    │                                                  ▲   │
    │ reads                                    claim,  │   │ events
    ▼                                          refund  │   ▼
 Relayer (indexer, read API, gas-only worker) ─────────┘  Postgres index
    └──▶ encrypted evidence (object storage + IPFS)
```

* **Web app** (`apps/web`): Next.js. Public pages are rendered on the server and ship no wallet code; the signed-in app uses Privy and wagmi.
* **Relayer** (`services/relayer`): indexes the contracts' events, serves the read API, stores encrypted evidence and deal terms, sends the routine claim and refund transactions from a gas-only wallet, sends email, and raises operator alerts.
* **Network manifest** (`packages/network`): the one place that holds each network's chain id, RPC, USDC and contract addresses. The web app and the relayer both read it, and mainnet resolves only from the checked-in manifest.

More in [Architecture](docs/reference/architecture.md).

## Repository layout

| Path | What it is |
|---|---|
| `contracts/` | Solidity (Foundry): `src/` (core, libraries, registry, vaults, interfaces), `test/` (unit, fuzz, invariant, fork), `script/` (deploy) |
| `apps/web/` | Next.js web app for buyers, suppliers, attestors, arbiters and the operator console |
| `apps/prototype/` | A design prototype of the interface with demo data, kept separate and not deployed |
| `services/relayer/` | Indexer, read API, evidence upload, email, operator alerts and the gas-only claim and refund worker |
| `packages/network/` | Network manifests (Arc testnet, Arc mainnet) shared by the web app and the relayer |
| `docs/` | Documentation |
| `render.yaml` | The relayer's hosting definition (Render) |

## Getting started

You need Node.js 22, Bun 1.4 and Foundry.

```bash
npm install
npm test                   # network package, relayer and web tests
npm run typecheck
npm run dev:web            # http://localhost:3000, pointed at the network in apps/web/.env.local
```

```bash
cd contracts
forge build
forge test                 # unit, fuzz and invariant tests
```

The web app needs a network and a Privy app id. Copy `apps/web/.env.example` to `apps/web/.env.local` and set `NEXT_PUBLIC_WAYBILL_NETWORK` (`testnet` is the safe choice for local work), `NEXT_PUBLIC_WAYBILL_API_BASE_URL` and `NEXT_PUBLIC_PRIVY_APP_ID`. The relayer is configured from `services/relayer/.env.example`; run it with `bun src/main.ts` from `services/relayer`. [Operations](docs/operations.md) lists every setting.

Never put keys, tokens or database URLs in the repository. `.env` files are ignored by git.

## Documentation

* [How it works](docs/how-it-works.md): a deal from start to payout, and what you are trusting.
* [Using the app](docs/using-the-app.md): buyers, suppliers, attestors and arbiters.
* [Disputes](docs/disputes.md), [Fees and limits](docs/fees-and-limits.md), [FAQ](docs/faq.md), [Roadmap](docs/roadmap.md).
* Reference: [architecture](docs/reference/architecture.md), [contracts](docs/reference/contracts.md), [deal lifecycle](docs/reference/deal-lifecycle.md), [attestations](docs/reference/attestations.md), [API](docs/reference/api.md), [security model](docs/reference/security.md), [data model](docs/reference/data-model.md).
* Operators: [operations](docs/operations.md) and [mainnet deployment](docs/mainnet-deploy.md).
