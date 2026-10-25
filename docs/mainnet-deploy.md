# Mainnet deployment

How the Arc mainnet contracts were deployed and checked, and how to repeat it for a new deployment. The addresses are in [Contracts](reference/contracts.md).

## What was deployed

| | |
|---|---|
| Date | 2026-10-24 |
| Chain | Arc mainnet, chain id 5042 |
| Built from | commit `fc84739` |
| Deployer, pauser and treasury | `0x74B4134C8d527a8D8AE8cb9503ab2043bCfC0ffd` |
| Transactions | 13, all successful, blocks 27,635,943 to 27,636,020 |
| Cost | about 0.43 USDC in gas (18.6 million gas at 23 gwei) |

The 13 transactions are the six logic libraries, the arbiter list, the attestor registry, the escrow, the bond vault, the financing vault, and two `addWriter` calls registering the escrow and the bond vault in the registry.

## The script

`contracts/script/DeployWaybill.s.sol` deploys everything in one broadcast. Forge links the six libraries (deployed through the standard CREATE2 factory, which exists on Arc mainnet) into the escrow. The broadcasting account **must** be the pauser, because `addWriter` can be called only by the pauser, and the script stops if they differ. The treasury is set to the pauser's address; it can be moved later with `scheduleSetTreasury`, which waits 48 hours.

Settings, as environment variables:

| Variable | Value used |
|---|---|
| `WAYBILL_DEPLOY_USDC` | `0x3600000000000000000000000000000000000000` |
| `WAYBILL_DEPLOY_PAUSER` | the operator wallet (also the treasury) |
| `WAYBILL_DEPLOY_MAX_DEAL` | `1000000000` (1,000 USDC, raw 6-decimal units) |
| `WAYBILL_DEPLOY_MAX_LOCKED` | `10000000000` (10,000 USDC) |
| `WAYBILL_DEPLOY_ARBITERS` | the three launch arbiters, comma-separated |

## Before broadcasting

1. **Build and test.** `forge build` with no warnings, and `forge test` green.
2. **Check the network facts with `cast`,** not from memory: chain id 5042, the RPC, USDC at `0x3600…0000` (6 decimals, not a proxy), the CREATE2 factory, Multicall3, and the operator wallet's balance and nonce.
3. **Dry run.** Run the script without `--broadcast`:

   ```bash
   cd contracts
   WAYBILL_DEPLOY_USDC=… WAYBILL_DEPLOY_PAUSER=… WAYBILL_DEPLOY_MAX_DEAL=… \
   WAYBILL_DEPLOY_MAX_LOCKED=… WAYBILL_DEPLOY_ARBITERS=… \
   forge script script/DeployWaybill.s.sol:DeployWaybill \
     --rpc-url https://rpc.mainnet.arc.io --sender <operator wallet>
   ```

   Check that it simulates 13 transactions from the operator wallet, that the constructor values are as intended, and that the operator wallet holds more than the padded gas estimate. The contract addresses are derived from the operator wallet's transaction count, so do not send anything else from it between the dry run and the broadcast.
4. **Arbiters.** Confirm each arbiter address is a wallet you control and has no code on mainnet.

## Broadcasting

Run the same command with `--broadcast --slow` and the signing method of your choice (for example a keystore with `--account <name>`, or a hardware wallet with `--ledger`). `--slow` sends each transaction only after the previous one confirms. The run writes a record to `contracts/broadcast/DeployWaybill.s.sol/5042/run-latest.json`, which is not committed.

## Checking the result

All of these were checked against the live chain with `cast` after the deploy:

* every contract has code (the escrow's runtime is 18,423 bytes);
* the escrow's USDC, treasury, pauser, arbiter list and registry addresses are as set;
* `maxDealAmount` is 1,000,000,000 and `maxLocked` is 10,000,000,000; the fee range is 50 to 100; there is no pending cap change; the next deal id is 0, nothing is locked, and new deals are not paused;
* `isAllowed` is true for the three arbiters and false for the pauser and for an unrelated address;
* the registry's writers are the escrow and the bond vault, and nothing else;
* both vaults' pauser is the operator wallet and the financing vault points at the new escrow;
* each deploy block, found by checking that the contract has no code one block earlier.

## Verifying source

The Arc explorer's own verification API is behind a browser challenge that blocks command-line tools, so verify through [Sourcify](https://sourcify.dev), which supports Arc mainnet. The explorer then imports the result the first time someone opens the contract's page.

```bash
cd contracts
# libraries, constructor arguments are not needed
forge verify-contract <address> src/libraries/logic/AdminLogic.sol:AdminLogic \
  --chain-id 5042 --rpc-url https://rpc.mainnet.arc.io --verifier sourcify --watch

# contracts with constructor arguments
forge verify-contract <address> src/registry/ArbiterList.sol:ArbiterList \
  --chain-id 5042 --rpc-url https://rpc.mainnet.arc.io --verifier sourcify \
  --guess-constructor-args --watch
```

The escrow additionally needs `--libraries path:Name:address` for each of the six libraries. Because the build sets `bytecode_hash = "none"`, the result is a match, not an exact match.

## Wiring the app to the deployment

1. Fill `ARC_MAINNET` in `packages/network/src/networks.ts` with the addresses, the three deploy blocks (escrow, registry, arbiter list), Multicall3 and `earlyResolve`, each with a comment saying how it was checked. A checked-in mainnet manifest must be complete or the app and relayer refuse to start.
2. Run the tests; commit.
3. Deploy the relayer (see [Operations](operations.md)): its start block is the escrow's deploy block, and its schema is new.
4. Deploy the web app.
5. Create and complete one small deal end to end, from creation to payout, labelled as a team test, before telling anyone the deployment is open.

## Deploying again

A new escrow is a new deployment: new addresses, a new manifest entry, a fresh relayer schema and start block. Funded deals stay on the contract they were funded on; only new deals use the new one. The operator wallet is fixed in every contract, so a new operator is also a new deployment.
