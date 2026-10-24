# Repository layout

One git repository, four independently deployable or buildable units. npm workspaces share one install and one lockfile; nothing imports across units except through `packages/network`.

```
apps/web/            Production frontend (Next.js 16, App Router). Deployed on its own host.
apps/prototype/      Design prototype (Next.js, demo data only). Own lockfile, not a workspace.
services/relayer/    Relayer, indexer and read-only API (Node). Deployed as a long-running service.
packages/network/    Network manifests: chain ids, addresses, decimals. No secrets.
contracts/           Foundry project. Solidity changes are made in Arc Studio, then pulled here.
docs/                Behaviour contract and build log.
scripts/studio/      Leftover Arc Studio tooling. Not used by any build.
```

## Rules

- `apps/web` and `services/relayer` never import each other. Both may import `@waybill/network`.
- `@waybill/network/networks` is safe in the browser. `@waybill/network/runtime` reads `process.env` and is Node-only.
- The web app talks to the relayer over HTTP only (`NEXT_PUBLIC_WAYBILL_API_BASE_URL`). It signs every transaction itself with the user's wallet.
- Secrets live in each unit's own environment: `services/relayer/.env.example`, `apps/web/.env.example`. The repository-root `.env` holds only the testnet campaign wallets and is gitignored.

## Commands (from the repository root)

| Task | Command |
|---|---|
| Install everything | `npm install` |
| Web dev server | `npm run dev:web` (needs `apps/web/.env.local`, copied from `.env.example`) |
| Web production build | `npm run build:web` |
| Typecheck all workspaces | `npm run typecheck` |
| Tests, per unit | `npm run test:web`, `npm run test:relayer`, `npm run test:network` |
| Contracts | `cd contracts && forge build && forge test --no-match-path 'test-integration/*'` |
| Prototype | `npm run dev:prototype` (first run: `npm --prefix apps/prototype install`) |

## Deploying separately

Both builds need the repository root as the install context, because they use `packages/network`.

**Web (Node or Vercel).** Install at the root, build with `npm run build -w @waybill/web`, run with `npm run start -w @waybill/web`. Set the `NEXT_PUBLIC_*` variables from `apps/web/.env.example` on the host; they are inlined at build time, so change them by rebuilding. On Vercel, set the project root to `apps/web` and enable including files outside the root. The web app has no server code of its own: every server-side job lives in the relayer.

**Relayer (Node host or container).** Install at the root, then run the service from `services/relayer`. Its environment is in `services/relayer/.env.example`. Run exactly one writer instance (see `services/relayer/README.md`).

**Cross-origin access.** The relayer API answers browsers only for origins listed in `WAYBILL_API_ALLOWED_ORIGINS` (comma-separated, exact, no wildcard). Set it to the web app's origin; any other browser origin gets 403, and the API stays read-only (GET). Requests with no `Origin` header, such as health checks, are unaffected.

## Production checklist (web)

- `NEXT_PUBLIC_WAYBILL_NETWORK` set explicitly; mainnet needs the full `NEXT_PUBLIC_WAYBILL_MAINNET_*` set and fails closed otherwise.
- `NEXT_PUBLIC_WAYBILL_API_BASE_URL` points at the relayer, and that origin's web address is in the relayer's `WAYBILL_API_ALLOWED_ORIGINS`.
- The Privy app lists the production web origin as an allowed origin.
- Security headers are set in `apps/web/next.config.ts` (framing refused, no sniffing, HSTS, strict referrer). A script-source CSP needs per-request nonces and has not been added.
- `error.tsx`, `global-error.tsx` and `not-found.tsx` cover failed renders; none of them can send a transaction.
- The Chinese supplier copy is a draft and needs native review before the supplier link is shared with real suppliers.
