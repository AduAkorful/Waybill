# Deploying the QA instance: Vercel (web), Render (relayer), Supabase (database)

This puts the app on **Arc testnet** (test money) for QA. Nothing here touches mainnet. Accounts, secrets and DNS are yours: nothing in the repository holds a credential, and the values in `render.yaml` marked `sync: false` are entered in Render's dashboard.

Order matters because each piece needs the previous one's URL: Supabase, then Render, then Vercel, then go back and tell Render and Privy the Vercel URL.

## 0. Before you start

1. The repository must be on GitHub (or GitLab/Bitbucket) so Render and Vercel can read it. It has not been pushed anywhere yet.
2. A **Privy** app (https://dashboard.privy.io). Note its App ID. You will add the web origin to it in step 4.
3. Optional, for the full QA matrix: an **S3-compatible bucket** (Supabase Storage works: a private bucket, endpoint `https://<project-ref>.supabase.co/storage/v1/s3`, keys from Storage → S3 Connection) and a **Pinata** JWT whose key has only the `pinFileToIPFS` permission (dispute and attestation evidence), and a **Resend** API key with a verified sender (email). Without them the app still runs and says plainly that those features are off; sections 2 and 8 of `docs/qa/test-matrix.md` then cannot be fully tested.
4. A new throwaway wallet for the relayer's gas. Make one with `cast wallet new`, keep the key for step 2, and fund the address with a few testnet USDC from the Arc testnet faucet (gas on Arc is paid in USDC). This wallet never holds deal money.

Generate the evidence key (optional, only if you set up evidence): `echo 0x$(openssl rand -hex 32)`. Keep a copy: losing it makes stored evidence unreadable.

## 1. Supabase (database)

1. Create a project. Choose a region close to Render's. Save the database password.
2. **Connect** → **Session pooler** → copy the connection string (host `...pooler.supabase.com`, port **5432**, user `postgres.<project-ref>`). Put your password in. This is `WAYBILL_DATABASE_URL`.
3. **Project Settings → Database → SSL configuration** → download the certificate and paste its contents as `WAYBILL_DATABASE_CA` (PEM text).
4. Do nothing else: the relayer creates its tables on first start and locks them with row-level security. Optionally switch off the project's Data API (Settings → API) since nothing uses it.

## 2. Render (relayer)

1. **New → Blueprint**, pick the repository. Render reads `render.yaml` (a Docker web service, one instance, `/health` check, **Starter plan so it never sleeps**).
2. Fill in the prompted values:

| Variable | Value |
|---|---|
| `WAYBILL_DATABASE_URL` | the Supabase session-pooler string |
| `WAYBILL_DATABASE_CA` | the Supabase certificate (PEM) |
| `WAYBILL_RELAYER_PRIVATE_KEY` | the throwaway gas key from step 0 (with the `0x`) |
| `WAYBILL_API_ALLOWED_ORIGINS` | leave a placeholder for now such as `https://example.invalid`, set the real Vercel URL in step 4 |
| `WAYBILL_PUBLIC_WEB_URL` | the same Vercel URL later; blank for now |
| `WAYBILL_EVIDENCE_*` (all seven, or leave all blank) | S3 endpoint, bucket, region, access key id, secret, Pinata JWT, the 32-byte key |
| `WAYBILL_EMAIL_RESEND_API_KEY`, `WAYBILL_EMAIL_FROM` | blank for no email; if set, `WAYBILL_PUBLIC_WEB_URL` becomes required |

3. Deploy. Open `https://<service>.onrender.com/health`: it should answer `{"live":true,"ready":true,...}` with `rpc` and `database` ok. The service refuses to start (and the logs say why) on any missing or partial setting.
4. The first sync reads the chain from `WAYBILL_RELAYER_START_BLOCK` (about 40,000 blocks behind head, a few minutes; the registry and arbiter-list indexers read from their own deploy blocks and take longer). Watch `/v1/operator`: every `index.cursors` entry should reach the chain head. The public Arc RPC rate-limits; if the logs show `-32005` errors the loops retry on their own, just slowly.

## 3. Vercel (web)

1. **Add New → Project**, import the repository.
2. **Root Directory**: `apps/web`. Turn on **Include source files outside of the Root Directory** (the app imports `packages/network`). Framework: Next.js. Node 22.x.
3. Environment variables (Production):

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_WAYBILL_NETWORK` | `testnet` |
| `NEXT_PUBLIC_WAYBILL_API_BASE_URL` | `https://<service>.onrender.com` (no trailing slash) |
| `NEXT_PUBLIC_PRIVY_APP_ID` | your Privy App ID |

   These are baked in at build time: change one, then redeploy.
4. Deploy and note the production URL (for example `https://waybill-qa.vercel.app`).

## 4. Close the loop

1. Render: set `WAYBILL_API_ALLOWED_ORIGINS` to the exact Vercel production origin (no path, no trailing slash) and `WAYBILL_PUBLIC_WEB_URL` to the same URL. Save (it redeploys). Preview deployments get other URLs and will be refused by CORS; QA should use the production URL.
2. Privy dashboard → your app → **Allowed origins**: add the Vercel URL.
3. Vercel is already pointing at Render, so no change there.

## 5. Smoke check (5 minutes)

```bash
curl https://<service>.onrender.com/health
curl https://<service>.onrender.com/v1/operator        # chain figures, index cursors near head
curl -I https://<vercel-url>/                          # 200 with security headers
curl -s https://<vercel-url>/record/283 | grep -c Funded
```

In a browser at the Vercel URL: the front page shows a live deal count; `/attestors` lists real attestors; `/d/280` shows the supplier page; `/signin` opens the Privy dialog and signing in works from that origin; `/operator` shows figures; the browser console shows no errors (a `[Report Only]` CSP line is worth reporting).

Then hand QA the Vercel URL and `docs/qa/runbook.md` and `docs/qa/test-matrix.md`. In the runbook, skip section 2 (starting the stack): it is already running.

## 6. Things to know

- **One relayer.** Never raise Render's instance count above 1.
- **Cost.** Render Starter and a Supabase free or pro project; Vercel's hobby plan is enough for QA but is for non-commercial use.
- **Redeploying the relayer** is safe at any time: it resumes from its saved cursors. Migrations run on start.
- **Public RPC.** The relayer uses Arc's public testnet RPC, which rate-limits. For a long QA window, ask for a dedicated RPC and have the manifest changed deliberately; the relayer does not accept an RPC override from the environment.
- **Pauser actions** (pause, labels, approved arbiters) need the pauser wallet `0x4632…D0F1`, held by the team, signed in at `/operator`.
- **The email token** is never stored; the confirmation link is the only copy.
- **Rolling back the web app** is a Vercel redeploy of an earlier build; the database and relayer do not need to change for web-only changes.
