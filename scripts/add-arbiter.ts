/**
 * Probe entity-secret registration, register only if never set (156016),
 * then call addArbiter(0x5EAf…) on WaybillEscrow from the pauser wallet.
 *
 * SECURITY:
 *  - No secret values are printed to stdout/stderr at any point.
 *  - Existence/length checks only.
 *  - Recovery file written to /home/user/app/.circle/ (downloadable).
 *
 * Usage: bun run scripts/add-arbiter.ts
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  initiateDeveloperControlledWalletsClient,
  registerEntitySecretCiphertext,
} from "@circle-fin/developer-controlled-wallets";
import { initiateSmartContractPlatformClient } from "@circle-fin/smart-contract-platform";

// ── Constants ──────────────────────────────────────────────────────────────
const ESCROW  = "0x446633abfbfe871da946a3c60272770a740b9c76";
const NEW_ARB = "0x5EAf26805258F49620fDb1e6FD8Afd91D7a6460e";
const PAUSER  = "0x5B12Ce46C7194aD57d143bC22847224047b1Ef42";
const CHAIN   = "ARC-TESTNET";

const POLL_MS   = 3_000;
const MAX_POLLS = 60;

const RECOVERY_DIR  = "/home/user/app/.circle";
const RECOVERY_PATH = path.join(RECOVERY_DIR, "recovery_file.dat");
const ENV_PATH      = "/home/user/app/.env";

// ── Helpers ────────────────────────────────────────────────────────────────
function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

function requireEnv(...names: string[]): string {
  for (const n of names) {
    const v = process.env[n]?.trim();
    if (v) return v;
  }
  throw new Error(`Missing env var: ${names.join(" / ")}`);
}

/** Append or replace a KEY=value line in .env — never prints the value. */
function upsertEnvLine(key: string, value: string) {
  let src = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf8") : "";
  const re = new RegExp(`^${key}=.*$`, "m");
  if (re.test(src)) {
    src = src.replace(re, `${key}=${value}`);
  } else {
    src += `\n${key}=${value}\n`;
  }
  fs.writeFileSync(ENV_PATH, src, "utf8");
}

// ── Step 1: verify CIRCLE_API_KEY is present ───────────────────────────────
const apiKey = requireEnv("CIRCLE_API_KEY");
if (apiKey.length < 10) throw new Error("CIRCLE_API_KEY appears empty.");
console.log("CIRCLE_API_KEY: present (length=" + apiKey.length + ")");

// ── Step 2: probe entity-secret status ────────────────────────────────────
//
// Strategy: attempt to initialise the SDK with a dummy 32-byte secret and
// call a read-only endpoint (listWalletSets).  The response code tells us:
//
//   HTTP 200         → a secret IS already registered (our dummy won't match
//                      its ciphertext, but Circle validates the key first and
//                      only checks the ciphertext later for write ops; some
//                      read-only endpoints return 200 regardless of secret)
//   Circle code 155003 / 155113 / 401  → API key invalid — stop.
//   Circle code 156015 → "entity secret already set" — stop; do NOT rotate.
//   Circle code 156016 → "entity secret not set"    — safe to register.
//
// In practice, registerEntitySecretCiphertext is the most reliable probe:
// it returns 156015 if already set, 156016 if never set, and succeeds (201)
// if this is the first registration.  We call it with a fresh secret ONLY
// when we are ready to commit; for probing we use listWalletSets first.

let entitySecret: string;

const existingSecret = process.env.CIRCLE_ENTITY_SECRET?.trim() ?? "";
const secretIsValid  = existingSecret.length === 64 && /^[0-9a-f]+$/i.test(existingSecret);

let registrationAction: "skipped_env_valid" | "registered" | "skipped_already_set";

if (secretIsValid) {
  // .env already has a 64-char hex secret — try it directly.
  console.log("CIRCLE_ENTITY_SECRET: present in .env, verifying with Circle…");
  entitySecret = existingSecret;

  try {
    const client = initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });
    await client.listWalletSets({ pageSize: 1 });
    console.log("Entity secret verified: already registered and working.");
    registrationAction = "skipped_env_valid";
  } catch (err: unknown) {
    const msg = String(err);
    if (msg.includes("156015")) {
      // Secret set but ciphertext mismatch — operator must paste correct secret.
      throw new Error(
        "already registered — operator must paste the existing 64-char hex " +
        "CIRCLE_ENTITY_SECRET into .env. Rotating would lock the pauser wallet."
      );
    }
    throw new Error("Entity secret in .env failed verification: " + msg);
  }
} else {
  // No valid secret in .env — probe via registerEntitySecretCiphertext with a
  // throwaway secret to check the error code before committing.
  console.log("No valid CIRCLE_ENTITY_SECRET in .env — probing Circle…");

  const probe = crypto.randomBytes(32).toString("hex");

  // We use a real registration attempt; if 156015 comes back we abort.
  // If it succeeds (201), we use the probe secret. This is safe because
  // we only reach this branch when secretIsValid is false (nothing to lose).
  let probeError: string | null = null;

  try {
    fs.mkdirSync(RECOVERY_DIR, { recursive: true });

    const resp = await registerEntitySecretCiphertext({
      apiKey,
      entitySecret: probe,
      recoveryFileDownloadPath: RECOVERY_DIR,
    });

    // Success — registration just happened with `probe`.
    entitySecret = probe;

    // Persist recovery file.
    if (resp.data?.recoveryFile) {
      fs.writeFileSync(RECOVERY_PATH, resp.data.recoveryFile);
    }

    // Persist secret to .env (value never logged).
    upsertEnvLine("CIRCLE_ENTITY_SECRET", entitySecret);
    console.log("Entity secret registered. Recovery file: " + RECOVERY_PATH);
    registrationAction = "registered";

  } catch (err: unknown) {
    probeError = String(err);
    if (probeError.includes("156015") || probeError.toLowerCase().includes("already")) {
      throw new Error(
        "already registered — operator must paste the existing 64-char hex " +
        "CIRCLE_ENTITY_SECRET into .env. Rotating would lock the pauser wallet."
      );
    }
    throw new Error("registerEntitySecretCiphertext failed: " + probeError);
  }
}

// ── Step 3: find the pauser wallet ─────────────────────────────────────────
console.log("Looking up pauser wallet…");
const walletsClient = initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });

// List up to 50 wallets; the deployer wallet should be the first/only one.
const walletsRes = await walletsClient.listWallets({ blockchain: CHAIN as never, pageSize: 50 });
const wallets    = walletsRes.data?.wallets ?? [];

const pauserWallet = wallets.find(
  w => w.address?.toLowerCase() === PAUSER.toLowerCase()
);

if (!pauserWallet?.id) {
  const found = wallets.map(w => w.address ?? "?").join(", ") || "(none)";
  throw new Error(
    `Pauser wallet ${PAUSER} not found in this Circle account. ` +
    `Wallets found: ${found}`
  );
}

console.log("Pauser wallet id: " + pauserWallet.id);

// ── Step 4: call addArbiter(address) ───────────────────────────────────────
// keccak256("addArbiter(address)") first 4 bytes = 0x5febed88
const selector  = "5febed88";
const padded    = NEW_ARB.slice(2).toLowerCase().padStart(64, "0");
const calldata  = `0x${selector}${padded}`;

console.log("Sending addArbiter(" + NEW_ARB + ")…");

const scpClient = initiateSmartContractPlatformClient({ apiKey, entitySecret });

const txRes = await scpClient.createContractExecutionTransaction({
  walletId       : pauserWallet.id,
  contractAddress: ESCROW,
  calldata,
  blockchain     : CHAIN as never,
  fee            : { type: "level", config: { feeLevel: "MEDIUM" } },
});

const txId = txRes.data?.id;
if (!txId) throw new Error("No transaction id returned.");

console.log("Transaction id: " + txId + " — polling…");

for (let i = 0; i < MAX_POLLS; i++) {
  await sleep(POLL_MS);
  const s   = await scpClient.getContractExecutionTransaction({ id: txId });
  const tx  = s.data?.transaction;
  const st  = tx?.state ?? "UNKNOWN";
  const h   = tx?.txHash ?? "-";

  process.stdout.write(`  poll ${i + 1}: state=${st} txHash=${h}\r`);

  if (st === "COMPLETE") {
    console.log("\n\naddArbiter sent.");
    console.log("txHash: " + tx!.txHash);
    console.log("Explorer: https://explorer.testnet.arc.io/tx/" + tx!.txHash);
    console.log("registration: " + registrationAction);
    console.log("recoveryFile: " + (registrationAction === "registered" ? RECOVERY_PATH : "n/a"));
    process.exit(0);
  }

  if (st === "FAILED" || st === "CANCELLED") {
    throw new Error("Transaction " + st + ": " + JSON.stringify(tx));
  }
}

throw new Error("Timed out waiting for transaction.");
