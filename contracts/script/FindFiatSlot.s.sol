// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import "forge-std/Script.sol";

interface IUSDC {
    function balanceOf(address) external view returns (uint256);
}

contract FindFiatSlot is Script {
    function run() external {
        address proxy = 0x3600000000000000000000000000000000000000;
        address probe = address(0xBEEF999);

        // Circle FiatToken balances mapping: typically slot 9
        // Try slots 0-20
        for (uint256 i = 0; i < 25; i++) {
            bytes32 slot = keccak256(abi.encode(probe, i));
            bytes32 current = vm.load(proxy, slot);
            vm.store(proxy, slot, bytes32(uint256(0xABCD1234)));
            uint256 bal = IUSDC(proxy).balanceOf(probe);
            vm.store(proxy, slot, current);
            if (bal == 0xABCD1234) {
                console.log("FOUND: balanceOf mapping slot =", i);
                return;
            }
        }
        console.log("Not found slots 0-24");
    }
}
