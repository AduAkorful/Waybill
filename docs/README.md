# Waybill

Waybill holds a buyer's USDC in an escrow contract on Arc and pays an overseas supplier one part at a time, as the people both sides agreed on confirm each part.

A buyer splits an order into parts, for example a deposit, production and delivery, and names who confirms each one: an inspector, a forwarder, the buyer, or just a due date. The supplier and every named confirmer accept before any money moves. The buyer then locks the USDC in the contract. As each part is confirmed it is paid to the supplier. If something goes wrong, the buyer can dispute a part and a named arbiter decides where that one part goes.

Nobody at Waybill can move, freeze or redirect money held in a deal. The contract's rules are fixed when the deal is created.

> **Early access.** Waybill is live on Arc mainnet with limits: no deal can be larger than 1,000 USDC, and the escrow holds at most 10,000 USDC in total. The contracts have not had an independent audit. See [Fees and limits](fees-and-limits.md) and [Security model](reference/security.md).

## Read first

* [How it works](how-it-works.md): a deal from start to payout, and what you are trusting.
* [Using the app](using-the-app.md): step by step for buyers, suppliers, attestors and arbiters.
* [Disputes](disputes.md): what happens when a part is disputed, and the deadlines.
* [Fees and limits](fees-and-limits.md): who pays what, and the early-access limits.
* [FAQ](faq.md)
* [Roadmap](roadmap.md): what is not available yet.

## Reference

For developers, integrators and reviewers.

* [Architecture](reference/architecture.md): the contracts, the relayer, the web app, and how data flows.
* [Contracts](reference/contracts.md): deployed addresses, roles, functions and events.
* [Deal lifecycle](reference/deal-lifecycle.md): every state, timer and transition.
* [Attestations](reference/attestations.md): the signed statement and how the contract checks it.
* [API](reference/api.md): the relayer's HTTP routes.
* [Security model](reference/security.md): what each actor can and cannot do, and the known limits.
* [Data model](reference/data-model.md): what is stored offchain, and what is authoritative.

## For operators

These pages are for whoever runs the deployment.

* [Operations](operations.md): settings, monitoring, alerts and what to do about them.
* [Mainnet deployment](mainnet-deploy.md): how the contracts were deployed and checked.

## Repository

| Path | What it is |
|---|---|
| `contracts/` | Solidity (Foundry): the escrow and its linked logic libraries, the arbiter list, the attestor registry, and the bond and financing vaults |
| `apps/web/` | Next.js web app |
| `apps/prototype/` | A design prototype of the interface with demo data; separate and not deployed |
| `services/relayer/` | Indexer, read API, evidence upload, email, operator alerts and the gas-only claim and refund worker |
| `packages/network/` | The network manifests (Arc testnet and Arc mainnet) shared by the web app and the relayer |
