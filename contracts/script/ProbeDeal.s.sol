// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import "forge-std/Script.sol";

interface IUSDC {
    function balanceOf(address) external view returns (uint256);
}

contract ProbeDeal is Script {
    function run() external {
        address usdc = 0x3600000000000000000000000000000000000000;
        address probe = address(0xABCD);

        // Use vm.deal style — actually deal() is on Test not Script.
        // Instead: try writing higher slots (21-60) to find the balance mapping.
        for (uint256 i = 20; i <= 60; i++) {
            bytes32 slot = keccak256(abi.encode(probe, i));
            bytes32 current = vm.load(usdc, slot);
            vm.store(usdc, slot, bytes32(uint256(0xBEEF)));
            uint256 bal = IUSDC(usdc).balanceOf(probe);
            vm.store(usdc, slot, current);
            if (bal == 0xBEEF) {
                console.log("FOUND balanceOf mapping at slot", i);
                return;
            }
        }
        
        // Try higher ranges
        for (uint256 i = 60; i <= 200; i++) {
            bytes32 slot = keccak256(abi.encode(probe, i));
            bytes32 current = vm.load(usdc, slot);
            vm.store(usdc, slot, bytes32(uint256(0xBEEF)));
            uint256 bal = IUSDC(usdc).balanceOf(probe);
            vm.store(usdc, slot, current);
            if (bal == 0xBEEF) {
                console.log("FOUND balanceOf mapping at slot", i);
                return;
            }
        }
        console.log("Not found in 0-200");
        
        // Check EIP-1967 admin slot and impl slot
        bytes32 implSlot = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;
        bytes32 adminSlot = 0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103;
        console.log("EIP-1967 impl:");
        console.logBytes32(vm.load(usdc, implSlot));
        console.log("EIP-1967 admin:");
        console.logBytes32(vm.load(usdc, adminSlot));
    }
}
