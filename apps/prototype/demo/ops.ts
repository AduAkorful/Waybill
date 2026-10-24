// DEMO DATA for the operator monitor. Invented figures; the live parts come from the demo store.
// The operator can read everything and pause NEW deals. There is no action here that touches a deal or its money.

export const opsBase = {
  /** Cumulative volume locked to date, USDC cents, split by who the parties are */
  volume: {
    thirdParty: 4_218_000,
    team: 612_500,
    test: 9_840_000,
  },
  relayer: {
    address: "0x5b12…c9e4",
    balanceUsdc: 41_820_000,
    warnBelowUsdc: 10_000_000,
    lastPolledSecondsAgo: 11,
    cursorBlock: 18_442_907,
    chainHeadBlock: 18_442_908,
    pendingAttempts: 0,
    failedAttempts24h: 0,
  },
  caps: { perDealUsdc: 5_000_000, totalLockedUsdc: 25_000_000 },
  health: [
    { name: "Chain reads (Arc RPC)", ok: true, note: "Live, 1 confirmation" },
    { name: "Indexer", ok: true, note: "1 block behind" },
    { name: "Relayer wallet", ok: true, note: "41.82 USDC for gas" },
    { name: "Database", ok: true, note: "Migrations 001–006 applied" },
    { name: "Reconciliation", ok: true, note: "Locked on chain = sum of open deals" },
  ],
};
