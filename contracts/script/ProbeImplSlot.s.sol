// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import "forge-std/Script.sol";
import "forge-std/StdStorage.sol";

contract ProbeImplSlot is Script {
    using stdStorage for StdStorage;

    function run() external {
        // Implementation (logic) contract behind the proxy
        address impl = 0xC6AD664ac6679F4Ce74e10E91449C93Ec1ae3cA6;
        address proxy = 0x3600000000000000000000000000000000000000;
        address probe = address(0xDEAD);

        // stdstore against the proxy (storage lives on proxy, but we must target proxy)
        // The issue: stdstore probes balanceOf on the proxy and the result is unchanged by
        // writing the slot because the implementation reads from a different slot layout.
        // Strategy: try common USDC slot patterns directly against the PROXY.
        //   - FiatTokenV2: balanceOf is at mapping slot 9 (balances mapping)
        //   - FiatTokenV1: balanceOf is at mapping slot 9
        //   - Circle USDC v2.2: might differ

        // Print raw proxy storage slots 0-15
        console.log("=== Proxy storage slots ===");
        for (uint256 i = 0; i < 16; i++) {
            bytes32 val = vm.load(proxy, bytes32(i));
            if (val != bytes32(0)) {
                console.log("proxy slot", i);
                console.logBytes32(val);
            }
        }

        // Try stdstore against IMPL directly (where storage logically lives is on PROXY,
        // but stdstore needs to write/read through the proxy's storage)
        // Manual approach: try slots 0-20 as mapping(address=>uint) candidates
        console.log("=== Brute-force balanceOf slot on PROXY ===");
        for (uint256 i = 0; i < 20; i++) {
            bytes32 slot = keccak256(abi.encode(probe, i));
            bytes32 current = vm.load(proxy, slot);
            // Write a sentinel
            vm.store(proxy, slot, bytes32(uint256(0xCAFE)));
            uint256 bal = IERC20Like(proxy).balanceOf(probe);
            // Restore
            vm.store(proxy, slot, current);
            if (bal == 0xCAFE) {
                console.log("FOUND: balanceOf mapping at slot", i);
                break;
            }
        }
    }
}

interface IERC20Like {
    function balanceOf(address) external view returns (uint256);
}
