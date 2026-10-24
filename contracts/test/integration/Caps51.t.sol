// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {WaybillEscrow} from "../../src/core/WaybillEscrow.sol";
import {IWaybillEscrow} from "../../src/interfaces/IWaybillEscrow.sol";
import {ArbiterList} from "../../src/registry/ArbiterList.sol";
import {AttestorRegistry} from "../../src/registry/AttestorRegistry.sol";
import {MockERC20} from "../helpers/MockERC20.sol";

/// @title Caps51 — early-access caps adjustable by the pauser (lower at once, raise after 48 hours)
contract Caps51 is Test {
    uint256 internal constant USDC_6 = 1e6;
    uint16 internal constant FEE_BPS = 50;
    uint256 internal constant MAX_DEAL = 1_000 * USDC_6;
    uint256 internal constant MAX_LOCKED = 5_000 * USDC_6;

    MockERC20 internal usdc;
    WaybillEscrow internal escrow;

    address internal pauser = address(0x1A);
    address internal treasury = address(0x1B);
    address internal arbiter = address(0x1C);
    address internal buyer = address(0x50);
    address internal supplier = address(0x51);
    address internal stranger = address(0x99);

    function setUp() public {
        usdc = new MockERC20("Mock USDC", "USDC", 6);
        address[] memory arbs = new address[](1);
        arbs[0] = arbiter;
        ArbiterList list = new ArbiterList(pauser, arbs);
        AttestorRegistry reg = new AttestorRegistry(pauser);
        escrow = new WaybillEscrow(address(usdc), treasury, pauser, MAX_DEAL, MAX_LOCKED, address(list), address(reg));
        vm.prank(pauser);
        reg.addWriter(address(escrow));
        usdc.mint(buyer, 1_000_000 * USDC_6);
        vm.prank(buyer);
        usdc.approve(address(escrow), type(uint256).max);
    }

    function _create(uint256 total) internal returns (uint256 dealId) {
        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](1);
        ms[0] = IWaybillEscrow.MilestoneInput({
            bps: 10_000,
            condition: IWaybillEscrow.ReleaseCondition.ACCEPTANCE,
            attestors: new address[](0),
            threshold: 0,
            deadline: uint64(block.timestamp + 30 days),
            gracePeriod: 0,
            reviewWindow: 0,
            dependsOn: type(uint16).max
        });
        vm.prank(buyer);
        dealId = escrow.createDeal(supplier, buyer, arbiter, total, FEE_BPS, uint64(block.timestamp + 7 days), 24, ms);
    }

    function _accept(uint256 dealId) internal {
        vm.prank(supplier);
        escrow.acceptSupplier(dealId, supplier);
        vm.prank(arbiter);
        escrow.acceptArbiter(dealId);
    }

    function _createAndFund(uint256 total) internal returns (uint256 dealId) {
        dealId = _create(total);
        _accept(dealId);
        vm.prank(buyer);
        escrow.fund(dealId);
    }

    // ── constructor and reads ────────────────────────────────────────────────

    function test_constructor_setsCaps() public view {
        assertEq(escrow.maxDealAmount(), MAX_DEAL);
        assertEq(escrow.maxLocked(), MAX_LOCKED);
        (uint256 d, uint256 l, uint64 eta) = escrow.getPendingCaps();
        assertEq(d + l + eta, 0, "nothing pending");
    }

    // ── lower ────────────────────────────────────────────────────────────────

    function test_lowerCaps_appliesImmediately() public {
        vm.expectEmit(address(escrow));
        emit IWaybillEscrow.CapsLowered(500 * USDC_6, 2_000 * USDC_6);
        vm.prank(pauser);
        escrow.lowerCaps(500 * USDC_6, 2_000 * USDC_6);
        assertEq(escrow.maxDealAmount(), 500 * USDC_6);
        assertEq(escrow.maxLocked(), 2_000 * USDC_6);

        vm.expectRevert(IWaybillEscrow.InvalidTotal.selector);
        _create(500 * USDC_6 + 1);
        _create(500 * USDC_6);
    }

    function test_lowerCaps_revertsForStranger() public {
        vm.prank(stranger);
        vm.expectRevert(IWaybillEscrow.NotPauser.selector);
        escrow.lowerCaps(1, 1);
    }

    function test_lowerCaps_revertsWhenRaisingOrZero() public {
        vm.startPrank(pauser);
        vm.expectRevert(IWaybillEscrow.InvalidCaps.selector);
        escrow.lowerCaps(MAX_DEAL + 1, MAX_LOCKED);
        vm.expectRevert(IWaybillEscrow.InvalidCaps.selector);
        escrow.lowerCaps(MAX_DEAL, MAX_LOCKED + 1);
        vm.expectRevert(IWaybillEscrow.InvalidCaps.selector);
        escrow.lowerCaps(0, MAX_LOCKED);
        vm.expectRevert(IWaybillEscrow.InvalidCaps.selector);
        escrow.lowerCaps(MAX_DEAL, 0);
        vm.stopPrank();
    }

    function test_lowerCaps_cancelsScheduledRaise() public {
        vm.startPrank(pauser);
        escrow.scheduleRaiseCaps(MAX_DEAL * 10, MAX_LOCKED * 10);
        escrow.lowerCaps(MAX_DEAL, MAX_LOCKED);
        (,, uint64 eta) = escrow.getPendingCaps();
        assertEq(eta, 0, "raise cancelled");
        vm.warp(block.timestamp + 48 hours);
        vm.expectRevert(IWaybillEscrow.NoPendingChange.selector);
        escrow.executeRaiseCaps();
        vm.stopPrank();
        assertEq(escrow.maxDealAmount(), MAX_DEAL);
    }

    function test_lowerCaps_belowLocked_blocksNewFundingOnly() public {
        uint256 funded = _createAndFund(MAX_DEAL);
        uint256 waiting = _create(MAX_DEAL);
        _accept(waiting);
        uint256 locked = escrow.currentLocked();

        vm.prank(pauser);
        escrow.lowerCaps(MAX_DEAL, locked - 1);

        vm.prank(buyer);
        vm.expectRevert(IWaybillEscrow.MaxLockedExceeded.selector);
        escrow.fund(waiting);

        // the deal funded under the old cap still pays out in full
        uint256 before = usdc.balanceOf(supplier);
        escrow.claim(funded, 0);
        assertEq(usdc.balanceOf(supplier) - before, MAX_DEAL);
        assertEq(escrow.currentLocked(), 0);
    }

    // ── raise ────────────────────────────────────────────────────────────────

    function test_raiseCaps_waits48Hours() public {
        vm.prank(pauser);
        vm.expectEmit(address(escrow));
        emit IWaybillEscrow.CapsRaiseScheduled(MAX_DEAL * 2, MAX_LOCKED * 2, uint64(block.timestamp + 48 hours));
        escrow.scheduleRaiseCaps(MAX_DEAL * 2, MAX_LOCKED * 2);
        assertEq(escrow.maxDealAmount(), MAX_DEAL, "unchanged while pending");

        (,, uint64 eta) = escrow.getPendingCaps();
        vm.warp(eta - 1);
        vm.prank(pauser);
        vm.expectRevert(IWaybillEscrow.ChangeDelayActive.selector);
        escrow.executeRaiseCaps();

        vm.warp(eta);
        vm.prank(pauser);
        vm.expectEmit(address(escrow));
        emit IWaybillEscrow.CapsRaised(MAX_DEAL * 2, MAX_LOCKED * 2);
        escrow.executeRaiseCaps();
        assertEq(escrow.maxDealAmount(), MAX_DEAL * 2);
        assertEq(escrow.maxLocked(), MAX_LOCKED * 2);
        (,, uint64 after_) = escrow.getPendingCaps();
        assertEq(after_, 0, "pending cleared");

        _create(MAX_DEAL * 2);
    }

    function test_raiseCaps_revertsForStranger() public {
        vm.prank(stranger);
        vm.expectRevert(IWaybillEscrow.NotPauser.selector);
        escrow.scheduleRaiseCaps(MAX_DEAL * 2, MAX_LOCKED * 2);

        vm.prank(pauser);
        escrow.scheduleRaiseCaps(MAX_DEAL * 2, MAX_LOCKED * 2);
        vm.warp(block.timestamp + 48 hours);
        vm.prank(stranger);
        vm.expectRevert(IWaybillEscrow.NotPauser.selector);
        escrow.executeRaiseCaps();
    }

    function test_raiseCaps_revertsWhenLoweringOrUnchanged() public {
        vm.startPrank(pauser);
        vm.expectRevert(IWaybillEscrow.InvalidCaps.selector);
        escrow.scheduleRaiseCaps(MAX_DEAL - 1, MAX_LOCKED * 2);
        vm.expectRevert(IWaybillEscrow.InvalidCaps.selector);
        escrow.scheduleRaiseCaps(MAX_DEAL * 2, MAX_LOCKED - 1);
        vm.expectRevert(IWaybillEscrow.InvalidCaps.selector);
        escrow.scheduleRaiseCaps(MAX_DEAL, MAX_LOCKED);
        vm.stopPrank();
    }

    function test_executeRaiseCaps_revertsWithNothingPending() public {
        vm.prank(pauser);
        vm.expectRevert(IWaybillEscrow.NoPendingChange.selector);
        escrow.executeRaiseCaps();
    }

    function test_scheduleRaiseCaps_replacesEarlierAndRestartsDelay() public {
        vm.prank(pauser);
        escrow.scheduleRaiseCaps(MAX_DEAL * 2, MAX_LOCKED * 2);
        vm.warp(block.timestamp + 47 hours);
        vm.prank(pauser);
        escrow.scheduleRaiseCaps(MAX_DEAL * 3, MAX_LOCKED * 3);
        vm.warp(block.timestamp + 1 hours);
        vm.prank(pauser);
        vm.expectRevert(IWaybillEscrow.ChangeDelayActive.selector);
        escrow.executeRaiseCaps();
    }

    // ── fuzz ─────────────────────────────────────────────────────────────────

    /// The cap in force when a deal is created bounds it, whatever sequence of lowers came before.
    function testFuzz_lowerCaps_boundsNewDeals(uint256 newDeal, uint256 total) public {
        newDeal = bound(newDeal, 1, MAX_DEAL);
        total = bound(total, 1, MAX_DEAL);
        vm.prank(pauser);
        escrow.lowerCaps(newDeal, MAX_LOCKED);
        if (total > newDeal) {
            vm.expectRevert(IWaybillEscrow.InvalidTotal.selector);
            _create(total);
        } else {
            _create(total);
        }
    }

    /// No raise ever takes effect before 48 hours have passed since it was scheduled.
    function testFuzz_raiseCaps_neverEarly(uint256 newDeal, uint256 newLocked, uint256 wait) public {
        newDeal = bound(newDeal, MAX_DEAL + 1, type(uint128).max);
        newLocked = bound(newLocked, MAX_LOCKED, type(uint128).max);
        wait = bound(wait, 0, 96 hours);
        vm.prank(pauser);
        escrow.scheduleRaiseCaps(newDeal, newLocked);
        vm.warp(block.timestamp + wait);
        vm.prank(pauser);
        if (wait < 48 hours) {
            vm.expectRevert(IWaybillEscrow.ChangeDelayActive.selector);
            escrow.executeRaiseCaps();
            assertEq(escrow.maxDealAmount(), MAX_DEAL);
        } else {
            escrow.executeRaiseCaps();
            assertEq(escrow.maxDealAmount(), newDeal);
            assertEq(escrow.maxLocked(), newLocked);
        }
    }
}
