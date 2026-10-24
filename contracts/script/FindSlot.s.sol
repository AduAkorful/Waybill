// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import "forge-std/Script.sol";

contract FindSlot is Script {
    function run() external pure {
        address dead = 0x000000000000000000000000000000000000dEaD;
        bytes32 target = 0x10d6a54a4754c8869d6886b5f5d7fbfa5b4522237ea5c60d11bc4e7a1ff9390b;
        for (uint256 i = 0; i < 300; i++) {
            if (keccak256(abi.encode(dead, i)) == target) {
                console.log("FOUND slot index:", i);
                return;
            }
        }
        console.log("Not found in 0-299");
    }
}
