// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import "forge-std/Script.sol";
import "forge-std/StdStorage.sol";

contract ProbeUSDCSlot is Script {
    using stdStorage for StdStorage;

    function run() external {
        address usdc = 0x3600000000000000000000000000000000000000;
        address probe = address(0xDEAD);

        // Use stdstore to find the slot automatically
        uint256 slot = stdstore
            .target(usdc)
            .sig("balanceOf(address)")
            .with_key(probe)
            .find();
        console.log("balanceOf slot for Arc USDC:", slot);

        // Also print first 15 storage slots for context
        for (uint256 i = 0; i < 15; i++) {
            bytes32 val = vm.load(usdc, bytes32(i));
            if (val != bytes32(0)) {
                console.log("raw slot", i);
                console.logBytes32(val);
            }
        }
    }
}
