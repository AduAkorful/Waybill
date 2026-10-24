// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {WaybillEscrow} from "../src/core/WaybillEscrow.sol";
import {ArbiterList} from "../src/registry/ArbiterList.sol";
import {AttestorRegistry} from "../src/registry/AttestorRegistry.sol";
import {BondVault} from "../src/vaults/BondVault.sol";
import {FinancingVault} from "../src/vaults/FinancingVault.sol";

/// @notice Deploys the whole Waybill set in one broadcast: the six linked logic libraries (forge deploys and links
///         them), the arbiter list, the attestor registry, the escrow and both vaults, then registers the escrow and
///         the bond vault as registry writers. The broadcasting key must be the pauser, because addWriter is
///         pauser-only.
///
/// Env:
///   WAYBILL_DEPLOY_USDC          USDC token (Arc: 0x3600000000000000000000000000000000000000)
///   WAYBILL_DEPLOY_TREASURY      protocol fee recipient
///   WAYBILL_DEPLOY_PAUSER        pauser (must equal the broadcaster)
///   WAYBILL_DEPLOY_MAX_DEAL      per-deal cap, raw 6-decimal units
///   WAYBILL_DEPLOY_MAX_LOCKED    total-held cap, raw 6-decimal units
///   WAYBILL_DEPLOY_ARBITERS      comma-separated initial arbiter list
contract DeployWaybill is Script {
    error BroadcasterIsNotPauser(address broadcaster, address pauser);

    function run() external {
        address usdc = vm.envAddress("WAYBILL_DEPLOY_USDC");
        address treasury = vm.envAddress("WAYBILL_DEPLOY_TREASURY");
        address pauser = vm.envAddress("WAYBILL_DEPLOY_PAUSER");
        uint256 maxDeal = vm.envUint("WAYBILL_DEPLOY_MAX_DEAL");
        uint256 maxLocked = vm.envUint("WAYBILL_DEPLOY_MAX_LOCKED");
        address[] memory arbiters = vm.envAddress("WAYBILL_DEPLOY_ARBITERS", ",");

        vm.startBroadcast();
        (, address broadcaster,) = vm.readCallers();
        if (broadcaster != pauser) revert BroadcasterIsNotPauser(broadcaster, pauser);

        ArbiterList list = new ArbiterList(pauser, arbiters);
        AttestorRegistry registry = new AttestorRegistry(pauser);
        WaybillEscrow escrow = new WaybillEscrow(usdc, treasury, pauser, maxDeal, maxLocked, address(list), address(registry));
        BondVault bond = new BondVault(usdc, pauser, address(escrow), address(registry));
        FinancingVault financing = new FinancingVault(usdc, pauser, address(escrow));
        registry.addWriter(address(escrow));
        registry.addWriter(address(bond));
        vm.stopBroadcast();

        console2.log("ArbiterList", address(list));
        console2.log("AttestorRegistry", address(registry));
        console2.log("WaybillEscrow", address(escrow));
        console2.log("BondVault", address(bond));
        console2.log("FinancingVault", address(financing));
    }
}
