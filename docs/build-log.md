# 04k Layout Restructuring Build Log

## Nature of Change

Layout and import path restructuring only. No production Solidity content was changed
beyond import path strings. No ABI, storage layout, constructor arguments, link
references, errors, events, permissions, fee math, or test semantics were altered.

## Studio-to-Repository Path Mapping

### Production sources

| Old path (Studio / pre-04k) | New path |
|---|---|
| `contracts/WaybillEscrow.sol` | `contracts/src/core/WaybillEscrow.sol` |
| `contracts/WaybillStorage.sol` | `contracts/src/core/WaybillStorage.sol` |
| `contracts/IWaybillEscrow.sol` | `contracts/src/interfaces/IWaybillEscrow.sol` |
| `contracts/IArbiterList.sol` | `contracts/src/interfaces/IArbiterList.sol` |
| `contracts/IAttestorRegistry.sol` | `contracts/src/interfaces/IAttestorRegistry.sol` |
| `contracts/IBondVault.sol` | `contracts/src/interfaces/IBondVault.sol` |
| `contracts/IFinancingVault.sol` | `contracts/src/interfaces/IFinancingVault.sol` |
| `contracts/libraries/logic/AdminLogic.sol` | `contracts/src/libraries/logic/AdminLogic.sol` |
| `contracts/libraries/logic/AttestLogic.sol` | `contracts/src/libraries/logic/AttestLogic.sol` |
| `contracts/libraries/logic/ClaimLogic.sol` | `contracts/src/libraries/logic/ClaimLogic.sol` |
| `contracts/libraries/logic/DealLogic.sol` | `contracts/src/libraries/logic/DealLogic.sol` |
| `contracts/libraries/logic/DisputeLogic.sol` | `contracts/src/libraries/logic/DisputeLogic.sol` |
| `contracts/libraries/logic/ViewLogic.sol` | `contracts/src/libraries/logic/ViewLogic.sol` |
| `contracts/ArbiterList.sol` | `contracts/src/registry/ArbiterList.sol` |
| `contracts/AttestorRegistry.sol` | `contracts/src/registry/AttestorRegistry.sol` |
| `contracts/BondVault.sol` | `contracts/src/vaults/BondVault.sol` |
| `contracts/FinancingVault.sol` | `contracts/src/vaults/FinancingVault.sol` |

### Test files

| Old path | New path | Classification |
|---|---|---|
| `contracts/test/WaybillEscrow.t.sol` | `contracts/test/integration/WaybillEscrow.t.sol` | integration |
| `contracts/test/AddressChange03d.t.sol` | `contracts/test/integration/AddressChange03d.t.sol` | integration |
| `contracts/test/ArbiterFee04c.t.sol` | `contracts/test/integration/ArbiterFee04c.t.sol` | integration |
| `contracts/test/BondVault03i.t.sol` | `contracts/test/integration/BondVault03i.t.sol` | integration |
| `contracts/test/CancelUnaccepted03k.t.sol` | `contracts/test/integration/CancelUnaccepted03k.t.sol` | integration |
| `contracts/test/Dependent04f.t.sol` | `contracts/test/integration/Dependent04f.t.sol` | integration |
| `contracts/test/Dispute03c.t.sol` | `contracts/test/integration/Dispute03c.t.sol` | integration |
| `contracts/test/Dispute04d.t.sol` | `contracts/test/integration/Dispute04d.t.sol` | integration |
| `contracts/test/FeePayer04g.t.sol` | `contracts/test/integration/FeePayer04g.t.sol` | integration |
| `contracts/test/FinancingVault03j.t.sol` | `contracts/test/integration/FinancingVault03j.t.sol` | integration |
| `contracts/test/FundFirst1271.t.sol` | `contracts/test/integration/FundFirst1271.t.sol` | integration |
| `contracts/test/Panel04h.t.sol` | `contracts/test/integration/Panel04h.t.sol` | integration |
| `contracts/test/Refund04e.t.sol` | `contracts/test/integration/Refund04e.t.sol` | integration |
| `contracts/test/Timelock03e.t.sol` | `contracts/test/integration/Timelock03e.t.sol` | integration |
| `contracts/test/ArbiterList03g.t.sol` | `contracts/test/unit/ArbiterList03g.t.sol` | unit |
| `contracts/test/AttestorRegistry03h.t.sol` | `contracts/test/unit/AttestorRegistry03h.t.sol` | unit |
| `contracts/test/AttestorRegistry04i.t.sol` | `contracts/test/unit/AttestorRegistry04i.t.sol` | unit |
| `contracts/test/Fuzz04j.t.sol` | `contracts/test/fuzz/Fuzz04j.t.sol` | fuzz |
| `contracts/test/Invariant04j.t.sol` | `contracts/test/invariant/Invariant04j.t.sol` | invariant |
| `contracts/test/WaybillEscrowFork.t.sol` | `contracts/test/fork/WaybillEscrowFork.t.sol` | fork |

### Helpers

| Old path | New path |
|---|---|
| `contracts/test-helpers/MockERC20.sol` | `contracts/test/helpers/MockERC20.sol` |
| `MockUSDC` (inline in WaybillEscrow.t.sol) | Still inline in `contracts/test/integration/WaybillEscrow.t.sol`; imported as `../integration/WaybillEscrow.t.sol` by tests that need it |

## Import Path Changes

### Within production source files

Logic libraries changed from `../../IWaybillEscrow.sol` / `../../WaybillStorage.sol`
to `../../interfaces/IWaybillEscrow.sol` / `../../core/WaybillStorage.sol` etc.

Core files changed from `./IWaybillEscrow.sol` to `../interfaces/IWaybillEscrow.sol` etc.

Registry and vault files changed from `./IXxx.sol` to `../interfaces/IXxx.sol`.

### Within test files

All test imports of `../WaybillEscrow.sol` changed to `../../src/core/WaybillEscrow.sol`.
All test imports of `../IWaybillEscrow.sol` changed to `../../src/interfaces/IWaybillEscrow.sol`.
All test cross-imports of `./WaybillEscrow.t.sol` changed to `../integration/WaybillEscrow.t.sol`.
Pattern applied consistently to all test subdirectories.

## Foundry Configuration

`foundry.toml` was NOT modified. Settings remain:

```toml
src = "contracts"
test = "contracts/test"
script = "contracts/script"
```

Foundry's recursive compilation under `contracts/` finds all new `src/` files automatically.
`remappings.txt` was NOT modified (no new remappings were required).

## Pre-Restructure Verification Counts

Recorded immediately before this restructuring (04j completion):

| Suite | Pass |
|---|---|
| All unit + integration (04a-04i) | 270/270 |
| Fuzz04j focused | 21/21 |
| Invariant04j focused | 11/11 (6 invariants + 5 regressions, 256 sequences x 500 calls) |
| Fork (WaybillEscrowFork) | 10/10 |
| Grand total | 302/302 non-fork + 10/10 fork |

## Post-Restructure Verification Commands

The following commands must be run after cloning to confirm the layout change did
not alter behavior. Do not deploy or broadcast as part of verification.

```bash
# Focused fuzz suite
forge test --match-path contracts/test/fuzz/Fuzz04j.t.sol

# Focused invariant suite
forge test --match-path contracts/test/invariant/Invariant04j.t.sol

# Full non-fork suite
forge test --no-match-path 'contracts/test/fork/**'

# Fork integration suite (requires Arc Testnet RPC)
forge test --match-path 'contracts/test/fork/**'

# Compile check with size report
forge build --sizes
```

## Build Products (Not Production Source)

The following are generated artefacts and must not be included as production source:

- `contracts/out/` — Foundry compiler output (ABI, bytecode JSON)
- `contracts/cache/` — Foundry compilation cache
- `contracts/contract-metadata/` — SCP-generated deployment metadata
- Any `build-info/` directories under `out/`

## Content Integrity

No production contract logic was changed. Only import path strings were updated.
The ABI surface, storage layout, constructor arguments, link references, errors,
events, permissions, fee math, and test semantics are identical to the pre-04k state.

Compile result for 04k: `forge build` exits 0 with warnings only (unused local
variables and unused function parameters pre-existing before this restructuring).
