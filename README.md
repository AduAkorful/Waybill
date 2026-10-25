# Waybill

Non-custodial USDC escrow on Arc. A buyer locks USDC for an order, and an overseas supplier is paid in stages as named attestors confirm each one. No operator can move, freeze or redirect money held in a deal.

Status: live on Arc mainnet in early access (deals up to 1,000 USDC, at most 10,000 USDC held in total), and on Arc testnet. The contracts have not had an independent audit.

App: [usewaybill.vercel.app](https://usewaybill.vercel.app). Documentation: [docs/](docs/README.md), starting with [How it works](docs/how-it-works.md). Deployed contracts and their addresses are in [docs/reference/contracts.md](docs/reference/contracts.md).

## Layout

| Path | What it is |
|---|---|
| `contracts/` | Solidity (Foundry): escrow, logic libraries, arbiter list, attestor registry, bond and financing vaults |
| `apps/web/` | Next.js web app for buyers, suppliers, attestors, arbiters and the operator console |
| `services/relayer/` | Indexer, read API, evidence upload, email, operator alerts and the gas-only claim/refund worker |
| `packages/network/` | Network manifests (Arc testnet, Arc mainnet) shared by the web app and the relayer |

## Commands

```bash
npm install
npm test
npm run typecheck
npm run dev:web
```

Contracts: `cd contracts && forge test`.
