// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import "forge-std/Script.sol";

interface IUSDC {
    function balanceOf(address) external view returns (uint256);
}

contract ProbeSlot10 is Script {
    function run() external {
        address proxy = 0x3600000000000000000000000000000000000000;
        address probe = address(0xBEEF55555);

        // Check balanceAndBlacklistStates at slot 10
        bytes32 slot10 = keccak256(abi.encode(probe, uint256(10)));
        console.log("Current value at slot 10:");
        console.logBytes32(vm.load(proxy, slot10));
        
        // Write a known value — but note: high bit must be 0 (not blacklisted)
        // balanceOf returns (stored & ~highBit), so write 12345 plain
        vm.store(proxy, slot10, bytes32(uint256(12345)));
        
        uint256 bal = IUSDC(proxy).balanceOf(probe);
        console.log("balanceOf after writing 12345 to slot 10:", bal);
        
        // Restore
        vm.store(proxy, slot10, bytes32(0));
        
        // Also check if balanceOf hits the Arc precompile
        // by checking slot 9 (pauser/initialized) for reference
        bytes32 slot9direct = bytes32(uint256(9));
        console.log("Slot 9 (masterMinter+initialized):");
        console.logBytes32(vm.load(proxy, slot9direct));
    }
}
