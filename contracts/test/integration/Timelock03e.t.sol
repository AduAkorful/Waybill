// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {WaybillEscrow} from "../../src/core/WaybillEscrow.sol";
import {IWaybillEscrow} from "../../src/interfaces/IWaybillEscrow.sol";
import {ArbiterList} from "../../src/registry/ArbiterList.sol";
import {IArbiterList} from "../../src/interfaces/IArbiterList.sol";
import {AttestorRegistry} from "../../src/registry/AttestorRegistry.sol";

// ---------------------------------------------------------------------------
// Minimal ERC-20 mock (identical pattern to other test files)
// ---------------------------------------------------------------------------
contract MockUSDC03e {
    string public name    = "Mock USDC";
    string public symbol  = "USDC";
    uint8  public decimals = 6;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external { balanceOf[to] += amount; }
    function totalSupply() external pure returns (uint256) { return type(uint256).max; }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "bal");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "bal");
        require(allowance[from][msg.sender] >= amount, "allow");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }
}

/// @title Timelock03e — parameter timelock tests
contract Timelock03e is Test {
    uint256 internal constant USDC_6 = 1e6;
    uint16  internal constant FEE_BPS = 75;

    MockUSDC03e   internal usdc;
    WaybillEscrow internal escrow;
    ArbiterList   internal arbList;

    address internal pauser   = address(0x1A);
    address internal treasury = address(0x1B);
    address internal arbiter  = address(0x1C);
    address internal newArb   = address(0x2A);
    address internal newTreas = address(0x2B);

    function setUp() public {
        usdc = new MockUSDC03e();
        address[] memory initArbs = new address[](1);
        initArbs[0] = arbiter;

        arbList = new ArbiterList(pauser, initArbs);
        AttestorRegistry reg = new AttestorRegistry(pauser);

        vm.prank(pauser);
        escrow = new WaybillEscrow(
            address(usdc),
            treasury,
            pauser,
            100_000 * USDC_6,
            1_000_000 * USDC_6,
            address(arbList),
            address(reg)
        );
        vm.prank(pauser); reg.addWriter(address(escrow));
    }

    // -------------------------------------------------------------------------
    // Test: addArbiter direct call reverts DirectParamChange
    // -------------------------------------------------------------------------

    function testDirectAddArbiterReverts() public {
        vm.prank(pauser);
        vm.expectRevert(IWaybillEscrow.DirectParamChange.selector);
        escrow.addArbiter(newArb);
    }

    // -------------------------------------------------------------------------
    // Test: schedule -> warp 48h -> execute -> arbiterAllowed
    // -------------------------------------------------------------------------

    function testScheduleExecuteAddArbiterAfter48h() public {
        assertFalse(arbList.isAllowed(newArb), "not yet allowed");

        vm.prank(pauser);
        arbList.scheduleAddArbiter(newArb, 0);

        (, uint64 eta) = arbList.getPendingAdd(newArb);
        assertGt(eta, 0, "eta set");

        // Cannot execute before delay
        vm.prank(pauser);
        vm.expectRevert(IArbiterList.ChangeDelayActive.selector);
        arbList.executeAddArbiter(newArb);

        // Warp to exactly eta
        vm.warp(eta);

        vm.prank(pauser);
        arbList.executeAddArbiter(newArb);

        assertTrue(arbList.isAllowed(newArb), "now allowed");
        assertTrue(escrow.arbiterAllowed(newArb), "escrow shim agrees");
        (, uint64 eta2) = arbList.getPendingAdd(newArb);
        assertEq(eta2, 0, "pending cleared");
    }

    // -------------------------------------------------------------------------
    // Test: execute before delay reverts ChangeDelayActive
    // -------------------------------------------------------------------------

    function testExecuteAddArbiterBeforeDelayReverts() public {
        vm.prank(pauser);
        arbList.scheduleAddArbiter(newArb, 0);

        // 1 second before eta
        (, uint64 eta) = arbList.getPendingAdd(newArb);
        vm.warp(eta - 1);

        vm.prank(pauser);
        vm.expectRevert(IArbiterList.ChangeDelayActive.selector);
        arbList.executeAddArbiter(newArb);
    }

    // -------------------------------------------------------------------------
    // Test: pauseNewDeals is still immediate (no delay)
    // -------------------------------------------------------------------------

    function testPauseStillImmediate() public {
        assertFalse(escrow.newDealsPaused(), "not paused");

        vm.prank(pauser);
        escrow.pauseNewDeals();

        assertTrue(escrow.newDealsPaused(), "paused immediately");

        vm.prank(pauser);
        escrow.unpauseNewDeals();

        assertFalse(escrow.newDealsPaused(), "unpaused immediately");
    }

    // -------------------------------------------------------------------------
    // Test: scheduleSetTreasury -> 48h -> executeSetTreasury -> fees go to new addr
    // -------------------------------------------------------------------------

    function testSetTreasuryAfterDelay() public {
        assertEq(escrow.treasury(), treasury, "initial treasury");

        vm.prank(pauser);
        escrow.scheduleSetTreasury(newTreas);

        (address proposed, uint64 eta) = escrow.getPendingTreasury();
        assertEq(proposed, newTreas, "proposed set");
        assertGt(eta, 0, "eta set");

        // Cannot execute before delay
        vm.prank(pauser);
        vm.expectRevert(IWaybillEscrow.ChangeDelayActive.selector);
        escrow.executeSetTreasury();

        vm.warp(eta);

        vm.prank(pauser);
        escrow.executeSetTreasury();

        assertEq(escrow.treasury(), newTreas, "treasury updated");

        // Pending cleared
        (address p2, uint64 e2) = escrow.getPendingTreasury();
        assertEq(p2, address(0), "pending cleared");
        assertEq(e2, 0, "eta cleared");

        // Fee accruals now go to newTreas: run a full deal
        address buyer    = address(0x50);
        address supplier = address(0x51);
        address supPay   = address(0x52);
        address buyRef   = address(0x53);

        uint256 total = 1_000 * USDC_6;
        uint256 fee   = (total * FEE_BPS + 9_999) / 10_000;

        usdc.mint(buyer, total + fee);

        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](1);
        ms[0] = IWaybillEscrow.MilestoneInput({
            bps: 10_000,
            condition: IWaybillEscrow.ReleaseCondition.ACCEPTANCE,
            attestors: new address[](0),
            threshold: 0,
            deadline: uint64(block.timestamp + 1 days),
            gracePeriod: 0,
            reviewWindow: 0,
            dependsOn: type(uint16).max
        });

        vm.prank(buyer);
        uint256 dealId = escrow.createDeal(
            supplier, buyRef, arbiter, total, FEE_BPS,
            uint64(block.timestamp + 7 days), 24, ms
        );

        vm.prank(supplier); escrow.acceptSupplier(dealId, supPay);
        vm.prank(arbiter);  escrow.acceptArbiter(dealId);

        vm.startPrank(buyer);
        usdc.approve(address(escrow), total + fee);
        escrow.fund(dealId);
        vm.stopPrank();

        escrow.claim(dealId, 0);

        // Fee should be in newTreas, not old treasury
        assertGt(escrow.feeBalance(newTreas), 0,  "fee accrued to new treasury");
        assertEq(escrow.feeBalance(treasury),   0,  "no fee to old treasury");
    }

    // -------------------------------------------------------------------------
    // Test: treasury change does NOT redirect fees on already-funded deals
    // -------------------------------------------------------------------------

    function testTreasuryChangeDoesNotRedirectExistingDealFees() public {
        address buyer    = address(0x60);
        address supplier = address(0x61);
        address supPay   = address(0x62);
        address buyRef   = address(0x63);

        uint256 total = 1_000 * USDC_6;
        uint256 fee   = (total * FEE_BPS + 9_999) / 10_000;

        usdc.mint(buyer, total + fee);

        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](1);
        ms[0] = IWaybillEscrow.MilestoneInput({
            bps: 10_000,
            condition: IWaybillEscrow.ReleaseCondition.ACCEPTANCE,
            attestors: new address[](0),
            threshold: 0,
            deadline: uint64(block.timestamp + 1 days),
            gracePeriod: 0,
            reviewWindow: 0,
            dependsOn: type(uint16).max
        });

        // Create and fund the deal (treasury is still the original address at this point)
        vm.prank(buyer);
        uint256 dealId = escrow.createDeal(
            supplier, buyRef, arbiter, total, FEE_BPS,
            uint64(block.timestamp + 7 days), 24, ms
        );
        vm.prank(supplier); escrow.acceptSupplier(dealId, supPay);
        vm.prank(arbiter);  escrow.acceptArbiter(dealId);
        vm.startPrank(buyer);
        usdc.approve(address(escrow), total + fee);
        escrow.fund(dealId);
        vm.stopPrank();

        // Now schedule + execute a treasury change to newTreas AFTER the deal is funded
        vm.prank(pauser);
        escrow.scheduleSetTreasury(newTreas);
        (, uint64 eta) = escrow.getPendingTreasury();
        vm.warp(eta);
        vm.prank(pauser);
        escrow.executeSetTreasury();
        assertEq(escrow.treasury(), newTreas, "treasury updated");

        // Claim the already-funded tranche — must credit OLD treasury, not newTreas
        escrow.claim(dealId, 0);

        assertGt(escrow.feeBalance(treasury),  0, "old treasury got the fee");
        assertEq(escrow.feeBalance(newTreas),  0, "new treasury got nothing");
    }
}
