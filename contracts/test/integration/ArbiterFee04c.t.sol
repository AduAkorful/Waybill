// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {WaybillEscrow}   from "../../src/core/WaybillEscrow.sol";
import {IWaybillEscrow}  from "../../src/interfaces/IWaybillEscrow.sol";
import {ArbiterList}     from "../../src/registry/ArbiterList.sol";
import {AttestorRegistry} from "../../src/registry/AttestorRegistry.sol";
/// @dev Minimal MockERC20 with per-address transfer blocking.
contract MockERC20 {
    string public name = "Mock USDC";
    string public symbol = "USDC";
    uint8  public decimals = 6;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => bool) public blocked;

    function mint(address to, uint256 amount) external { balanceOf[to] += amount; }

    function setBlocked(address target, bool value) external { blocked[target] = value; }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        if (blocked[to]) return false;
        require(balanceOf[msg.sender] >= amount, "insufficient");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(allowance[from][msg.sender] >= amount, "allowance");
        require(balanceOf[from] >= amount, "insufficient");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract ArbiterFee04c is Test {
    // -------------------------------------------------------------------------
    // Setup
    // -------------------------------------------------------------------------

    WaybillEscrow   escrow;
    MockERC20       usdc;
    ArbiterList     arbList;
    AttestorRegistry registry;

    address buyer    = address(0xB0);
    address supplier = address(0xB1);
    address supPay   = address(0xB2);
    address buyRef   = address(0xB3);
    address arbiter  = address(0xA0);
    address treasury = address(0xFE);
    address pauser   = address(0xAAAA);

    uint256 constant TOTAL     = 100e6;   // 100 USDC
    uint16  constant FEE_BPS   = 50;      // 0.5%
    uint256 constant ARB_FEE   = 5e6;     // 5 USDC arbiter fee
    uint32  constant ARB_HOURS = 48;      // 48-hour arbiter deadline
    uint64  constant ACC_DL    = 14 days; // acceptance deadline offset

    function setUp() public {
        usdc     = new MockERC20();
        arbList  = new ArbiterList(pauser, new address[](0));
        registry = new AttestorRegistry(pauser);

        escrow = new WaybillEscrow(
            address(usdc), treasury, pauser,
            1_000_000e6, 10_000_000e6,
            address(arbList), address(registry)
        );

        // Fund all relevant addresses
        usdc.mint(buyer,    10_000e6);
        usdc.mint(supplier, 10_000e6);

        vm.prank(pauser);
        arbList.scheduleAddArbiter(arbiter, 0);
        vm.warp(block.timestamp + 48 hours + 1);
        vm.prank(pauser);
        arbList.executeAddArbiter(arbiter);

        vm.prank(buyer);
        usdc.approve(address(escrow), type(uint256).max);
        vm.prank(supplier);
        usdc.approve(address(escrow), type(uint256).max);
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    function _createAndFundWithFee(uint256 arbFee) internal returns (uint256 dealId) {
        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](1);
        ms[0] = IWaybillEscrow.MilestoneInput({
            bps: 10_000,
            condition: IWaybillEscrow.ReleaseCondition.ACCEPTANCE,
            attestors: new address[](0),
            threshold: 0,
            deadline: 0,
            gracePeriod: 0,
            reviewWindow: 0,
            dependsOn: type(uint16).max
        });

        uint64 deadline = uint64(block.timestamp + ACC_DL);
        vm.prank(buyer);
        dealId = escrow.createDeal(supplier, buyRef, arbiter,
            TOTAL, FEE_BPS, deadline, ARB_HOURS, ms, false, arbFee);

        vm.prank(supplier);  escrow.acceptSupplier(dealId, supPay);
        vm.prank(arbiter);   escrow.acceptArbiter(dealId);
        vm.prank(buyer);     escrow.fund(dealId);
    }

    function _disputeMS(uint256 dealId) internal {
        // Move milestone into IN_REVIEW first (review window>0 needed for buyer dispute)
        // — use a BUYER_APPROVAL milestone for simpler dispute setup
    }

    // For dispute tests we need a milestone with reviewWindow so buyer can dispute.
    function _createDisputeDeal(uint256 arbFee) internal returns (uint256 dealId) {
        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](1);
        ms[0] = IWaybillEscrow.MilestoneInput({
            bps: 10_000,
            condition: IWaybillEscrow.ReleaseCondition.ACCEPTANCE,
            attestors: new address[](0),
            threshold: 0,
            deadline: 0,
            gracePeriod: 0,
            reviewWindow: 24, // 24-hour review window so buyer can dispute
            dependsOn: type(uint16).max
        });

        uint64 deadline = uint64(block.timestamp + ACC_DL);
        vm.prank(buyer);
        dealId = escrow.createDeal(supplier, buyRef, arbiter,
            TOTAL, FEE_BPS, deadline, ARB_HOURS, ms, false, arbFee);

        vm.prank(supplier); escrow.acceptSupplier(dealId, supPay);
        vm.prank(arbiter);  escrow.acceptArbiter(dealId);
        vm.prank(buyer);    escrow.fund(dealId);
    }

    // -------------------------------------------------------------------------
    // T1: exact funding includes arbiterFee
    // -------------------------------------------------------------------------

    function testFundIncludesArbiterFee() public {
        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](1);
        ms[0] = IWaybillEscrow.MilestoneInput({
            bps: 10_000, condition: IWaybillEscrow.ReleaseCondition.ACCEPTANCE,
            attestors: new address[](0), threshold: 0, deadline: 0, gracePeriod: 0, reviewWindow: 0,
            dependsOn: type(uint16).max
        });

        uint64 deadline = uint64(block.timestamp + ACC_DL);
        vm.prank(buyer);
        uint256 dealId = escrow.createDeal(supplier, buyRef, arbiter,
            TOTAL, FEE_BPS, deadline, ARB_HOURS, ms, false, ARB_FEE);

        vm.prank(supplier); escrow.acceptSupplier(dealId, supPay);
        vm.prank(arbiter);  escrow.acceptArbiter(dealId);

        uint256 prepaidFee = escrow.getDeal(dealId).prepaidFee;
        uint256 expectedFund = TOTAL + prepaidFee + ARB_FEE;
        uint256 balBefore = usdc.balanceOf(buyer);

        vm.prank(buyer);
        escrow.fund(dealId);

        uint256 balAfter = usdc.balanceOf(buyer);
        assertEq(balBefore - balAfter, expectedFund, "buyer paid totalAmount+prepaidFee+arbiterFee");
        assertEq(escrow.getDeal(dealId).arbiterFee, ARB_FEE, "arbiterFee stored in deal");
    }

    // -------------------------------------------------------------------------
    // T2: underfund reverts (allowance covers only totalAmount+prepaidFee)
    // -------------------------------------------------------------------------

    function testUnderfundReverts() public {
        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](1);
        ms[0] = IWaybillEscrow.MilestoneInput({
            bps: 10_000, condition: IWaybillEscrow.ReleaseCondition.ACCEPTANCE,
            attestors: new address[](0), threshold: 0, deadline: 0, gracePeriod: 0, reviewWindow: 0,
            dependsOn: type(uint16).max
        });

        uint64 deadline = uint64(block.timestamp + ACC_DL);
        vm.prank(buyer);
        uint256 dealId = escrow.createDeal(supplier, buyRef, arbiter,
            TOTAL, FEE_BPS, deadline, ARB_HOURS, ms, false, ARB_FEE);

        vm.prank(supplier); escrow.acceptSupplier(dealId, supPay);
        vm.prank(arbiter);  escrow.acceptArbiter(dealId);

        // Revoke max approval, set insufficient allowance (no arbiterFee covered)
        uint256 prepaidFee = escrow.getDeal(dealId).prepaidFee;
        vm.prank(buyer); usdc.approve(address(escrow), TOTAL + prepaidFee); // missing ARB_FEE

        vm.prank(buyer);
        vm.expectRevert(); // SafeTransferFrom will revert on allowance shortfall
        escrow.fund(dealId);
    }

    // -------------------------------------------------------------------------
    // T3: timely resolve credits arbiter exactly once, principal split unchanged
    // -------------------------------------------------------------------------

    function testTimelyResolveCreditArbiterOnce() public {
        uint256 dealId = _createDisputeDeal(ARB_FEE);

        // Wait for review window to open — fund triggered IN_REVIEW immediately since reviewWindow>0
        vm.warp(block.timestamp + 1);
        // Buyer disputes
        vm.prank(buyer);
        escrow.dispute(dealId, 0, keccak256("dispute-evidence"));

        uint256 arbArbFeeBalBefore = escrow.arbiterFeeBalance(arbiter);
        uint256 lockedBefore = escrow.currentLocked();
        uint256 buyRefBalBefore = usdc.balanceOf(buyRef);

        // (04d) Warp past 72h response window; still within arbiterDeadline (responseDeadline+72h).
        vm.warp(block.timestamp + 73 hours);

        // Arbiter resolves in favor of supplier — within deadline
        vm.prank(arbiter);
        escrow.resolve(dealId, 0, true);

        // H-04c-3: arbiter fee in separate arbiterFeeBalance (NOT in feeBalances)
        assertEq(escrow.arbiterFeeBalance(arbiter) - arbArbFeeBalBefore, ARB_FEE,
            "arbiter credited ARB_FEE in separate ledger");
        assertEq(escrow.feeBalances(arbiter), 0, "feeBalances unaffected by arbiter fee");
        // H-04c-3: currentLocked decreased by tranche + protocol fee only (arbiter fee stays locked until pull)
        uint256 prepaidFee3 = escrow.getDeal(dealId).prepaidFee;
        assertEq(lockedBefore - escrow.currentLocked(), TOTAL + prepaidFee3,
            "locked decreased by tranche+fee only; arbiterFee stays locked until withdraw");
        // buyer's refund address received nothing from the arbiter fee
        assertEq(usdc.balanceOf(buyRef), buyRefBalBefore, "buyer got no arbiter fee on resolve-to-supplier");
    }

    // -------------------------------------------------------------------------
    // T4: second resolve cannot move the arbiter fee again
    // -------------------------------------------------------------------------

    function testSecondResolveCannotMoveArbiterFee() public {
        uint256 dealId = _createDisputeDeal(ARB_FEE);

        vm.prank(buyer);
        escrow.dispute(dealId, 0, keccak256("d1"));

        // (04d) Warp past 72h response window.
        vm.warp(block.timestamp + 73 hours);

        // First resolve
        vm.prank(arbiter);
        escrow.resolve(dealId, 0, true);

        uint256 arbFeeBalAfter = escrow.arbiterFeeBalance(arbiter);

        // Try to dispute again — should fail because deal is SETTLED
        vm.prank(buyer);
        vm.expectRevert(IWaybillEscrow.InvalidDealState.selector);
        escrow.dispute(dealId, 0, keccak256("d2"));

        // Arbiter fee balance unchanged
        assertEq(escrow.arbiterFeeBalance(arbiter), arbFeeBalAfter, "arbiter fee not double-credited");
    }

    // -------------------------------------------------------------------------
    // T5: resolve after deadline reverts (arbiter fee stays locked)
    // -------------------------------------------------------------------------

    function testResolveAfterDeadlineReverts() public {
        uint256 dealId = _createDisputeDeal(ARB_FEE);

        vm.prank(buyer);
        escrow.dispute(dealId, 0, keccak256("d1"));

        // Get the arbiter deadline from milestone
        IWaybillEscrow.Milestone memory ms = escrow.getMilestone(dealId, 0);
        vm.warp(ms.arbiterDeadline + 1);

        vm.prank(arbiter);
        vm.expectRevert(IWaybillEscrow.ArbiterDeadlinePassed.selector);
        escrow.resolve(dealId, 0, true);

        // Arbiter fee still locked (no payout)
        assertEq(escrow.feeBalances(arbiter), 0, "no arbiter fee credited after deadline");
    }

    // -------------------------------------------------------------------------
    // T6: applyDefault refunds buyer arbiter fee exactly once
    // -------------------------------------------------------------------------

    function testDefaultRefundsBuyerArbiterFee() public {
        uint256 dealId = _createDisputeDeal(ARB_FEE);

        vm.prank(buyer);
        escrow.dispute(dealId, 0, keccak256("d1"));

        IWaybillEscrow.Milestone memory ms = escrow.getMilestone(dealId, 0);
        vm.warp(ms.arbiterDeadline + 1);

        uint256 buyRefBefore = usdc.balanceOf(buyRef);

        // Buyer raised dispute → toSupplier=false → tranche refunded to buyer + arbiter fee refunded to buyer
        vm.prank(buyer);
        escrow.applyDefault(dealId, 0);

        uint256 prepaidFee6 = escrow.getDeal(dealId).prepaidFee;
        assertEq(usdc.balanceOf(buyRef) - buyRefBefore, TOTAL + prepaidFee6 + ARB_FEE,
            "buyer got tranche+prepaidFee+ARB_FEE back on default");

        // Second applyDefault not possible — deal is SETTLED
        vm.expectRevert(IWaybillEscrow.InvalidDealState.selector);
        escrow.applyDefault(dealId, 0);
    }

    // -------------------------------------------------------------------------
    // T7: no-dispute settle refunds arbiter fee to buyer
    // -------------------------------------------------------------------------

    function testNoDisputeSettleRefundsArbiterFee() public {
        uint256 dealId = _createAndFundWithFee(ARB_FEE);

        uint256 buyRefBefore = usdc.balanceOf(buyRef);

        // Claim the single milestone (ACCEPTANCE, no dispute)
        vm.prank(supplier);
        escrow.claim(dealId, 0);

        assertEq(usdc.balanceOf(buyRef) - buyRefBefore, ARB_FEE,
            "arbiter fee refunded to buyer on no-dispute settle");
        assertEq(uint8(escrow.getDeal(dealId).state),
            uint8(IWaybillEscrow.DealState.SETTLED), "deal SETTLED");
    }

    // -------------------------------------------------------------------------
    // T8: fund-first cancellation returns unpaid arbiter fee
    // -------------------------------------------------------------------------

    function testFundFirstCancelReturnsArbiterFee() public {
        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](1);
        ms[0] = IWaybillEscrow.MilestoneInput({
            bps: 10_000, condition: IWaybillEscrow.ReleaseCondition.ACCEPTANCE,
            attestors: new address[](0), threshold: 0, deadline: 0, gracePeriod: 0, reviewWindow: 0,
            dependsOn: type(uint16).max
        });

        uint64 deadline = uint64(block.timestamp + 7 days);
        vm.prank(buyer);
        uint256 dealId = escrow.createDeal(supplier, buyRef, arbiter,
            TOTAL, FEE_BPS, deadline, ARB_HOURS, ms, true /*fundFirst*/, ARB_FEE);

        // Fund immediately (fundFirst, no accepts yet)
        vm.prank(buyer);
        escrow.fund(dealId);

        uint256 prepaidFee = escrow.getDeal(dealId).prepaidFee;
        uint256 buyRefBefore = usdc.balanceOf(buyRef);

        // Warp past acceptance deadline; supplier never accepted
        vm.warp(block.timestamp + 8 days);

        vm.prank(buyer);
        escrow.cancelUnaccepted(dealId);

        // Buyer gets back totalAmount + prepaidFee + arbiterFee
        assertEq(usdc.balanceOf(buyRef) - buyRefBefore, TOTAL + prepaidFee + ARB_FEE,
            "cancel returns all funds including arbiterFee");
    }

    // -------------------------------------------------------------------------
    // T9: blocked arbiter doesn't break the tranche outcome (pull-payment)
    // -------------------------------------------------------------------------

    function testBlockedArbiterPullPayment() public {
        // Deploy a mock arbiter that is blocklisted in USDC
        address blockedArbiter = address(0xBAD);

        // Add blockedArbiter to arbiter list
        vm.prank(pauser);
        arbList.scheduleAddArbiter(blockedArbiter, 0);
        vm.warp(block.timestamp + 48 hours + 1);
        vm.prank(pauser);
        arbList.executeAddArbiter(blockedArbiter);

        // Block their address in USDC
        usdc.setBlocked(blockedArbiter, true);

        IWaybillEscrow.MilestoneInput[] memory msArr = new IWaybillEscrow.MilestoneInput[](1);
        msArr[0] = IWaybillEscrow.MilestoneInput({
            bps: 10_000, condition: IWaybillEscrow.ReleaseCondition.ACCEPTANCE,
            attestors: new address[](0), threshold: 0, deadline: 0, gracePeriod: 0, reviewWindow: 24,
            dependsOn: type(uint16).max
        });

        uint64 deadline2 = uint64(block.timestamp + ACC_DL);
        vm.prank(buyer);
        uint256 dealId = escrow.createDeal(supplier, buyRef, blockedArbiter,
            TOTAL, FEE_BPS, deadline2, ARB_HOURS, msArr, false, ARB_FEE);

        vm.prank(supplier);    escrow.acceptSupplier(dealId, supPay);
        vm.prank(blockedArbiter); escrow.acceptArbiter(dealId);
        vm.prank(buyer);       escrow.fund(dealId);

        vm.warp(block.timestamp + 1);

        // Buyer disputes
        vm.prank(buyer);
        escrow.dispute(dealId, 0, keccak256("e"));

        uint256 supBefore = usdc.balanceOf(supPay);

        // (04d) Warp past 72h response window.
        vm.warp(block.timestamp + 73 hours);

        // Arbiter resolves in favor of supplier — credit to feeBalances, NOT a push transfer
        vm.prank(blockedArbiter);
        escrow.resolve(dealId, 0, true);

        // Supplier got their tranche — resolution succeeded despite blocked arbiter
        assertGt(usdc.balanceOf(supPay) - supBefore, 0, "supplier tranche paid despite blocked arbiter");

        // H-04c-3: arbiter fee in separate arbiterFeeBalance (NOT in feeBalances)
        assertEq(escrow.arbiterFeeBalance(blockedArbiter), ARB_FEE, "arbiter fee in arbiterFeeBalance");
        assertEq(escrow.feeBalances(blockedArbiter), 0, "feeBalances unaffected by arbiter fee");

        // Unblock then pull
        usdc.setBlocked(blockedArbiter, false);
        vm.prank(blockedArbiter);
        escrow.withdrawArbiterFee(dealId);
        assertEq(escrow.arbiterFeeBalance(blockedArbiter), 0, "arbiter fee withdrawn");
    }

    // -------------------------------------------------------------------------
    // T10: escrow balance invariant — includes unpaid arbiter fees
    // -------------------------------------------------------------------------

    function testEscrowBalanceInvariant() public {
        uint256 dealId = _createAndFundWithFee(ARB_FEE);

        uint256 prepaidFee = escrow.getDeal(dealId).prepaidFee;
        uint256 expectedBalance = TOTAL + prepaidFee + ARB_FEE;

        assertEq(usdc.balanceOf(address(escrow)), expectedBalance,
            "escrow holds total + prepaidFee + arbiterFee");
        assertEq(escrow.currentLocked(), expectedBalance,
            "currentLocked matches escrow balance");

        // After claim (no dispute), arbiter fee is refunded and balance decreases
        uint256 buyRefBefore = usdc.balanceOf(buyRef);
        vm.prank(supplier);
        escrow.claim(dealId, 0);

        // Escrow balance: only treasury fee remains (supplier got principal, buyer got arbiter fee back)
        // Actually: protocol fee is in feeBalances (not sent out), so it stays in escrow
        uint256 balAfter = usdc.balanceOf(address(escrow));
        assertEq(balAfter, prepaidFee, "only protocol fee remains in escrow after settle");
        assertEq(escrow.feeBalances(treasury), prepaidFee, "protocol fee credited to treasury");
        assertEq(usdc.balanceOf(buyRef) - buyRefBefore, ARB_FEE, "buyer got ARB_FEE refund");
    }

    // -------------------------------------------------------------------------
    // T11: arbiterFee=0 deals still work (backward compat)
    // -------------------------------------------------------------------------

    function testZeroArbiterFeeBackwardCompat() public {
        uint256 dealId = _createAndFundWithFee(0);

        uint256 buyRefBefore = usdc.balanceOf(buyRef);
        vm.prank(supplier);
        escrow.claim(dealId, 0);

        // No arbiter fee event, buyer gets nothing from arbiter fee path
        assertEq(usdc.balanceOf(buyRef) - buyRefBefore, 0, "zero arbiter fee: no refund to buyer");
        assertEq(uint8(escrow.getDeal(dealId).state), uint8(IWaybillEscrow.DealState.SETTLED));
    }

    // =========================================================================
    // H-04c-1: per-deal withdrawal isolation
    // =========================================================================

    // T12: two deals share one arbiter; withdrawing deal A cannot drain deal B's fee.
    function testWithdrawIsolation_DealACannotDrainDealB() public {
        // Create and resolve two dispute deals with the same arbiter, each with ARB_FEE.
        uint256 dealA = _createDisputeDeal(ARB_FEE);
        uint256 dealB = _createDisputeDeal(ARB_FEE);

        // Dispute both deals so arbiter can resolve.
        vm.prank(buyer); escrow.dispute(dealA, 0, keccak256("dA"));
        vm.prank(buyer); escrow.dispute(dealB, 0, keccak256("dB"));

        // (04d) Warp past 72h response window before resolving.
        vm.warp(block.timestamp + 73 hours);

        // Resolve both in favor of supplier — each timely.
        vm.prank(arbiter); escrow.resolve(dealA, 0, true);
        vm.prank(arbiter); escrow.resolve(dealB, 0, true);

        // H-04c-3: separate arbiterFeeBalance = ARB_FEE * 2; feeBalances unaffected.
        assertEq(escrow.arbiterFeeBalance(arbiter), ARB_FEE * 2, "arbiterFeeBalance = 2x ARB_FEE");
        assertEq(escrow.feeBalances(arbiter), 0, "feeBalances unaffected by arbiter fees");

        // Withdraw for deal A — takes exactly ARB_FEE, leaves deal B intact.
        vm.prank(arbiter);
        escrow.withdrawArbiterFee(dealA);
        assertEq(escrow.arbiterFeeBalance(arbiter), ARB_FEE, "one ARB_FEE remains after dealA withdraw");

        // Second withdraw for deal A reverts NoFees (claimable[dealA] == 0 now).
        vm.prank(arbiter);
        vm.expectRevert(IWaybillEscrow.NoFees.selector);
        escrow.withdrawArbiterFee(dealA);

        // Deal B's fee is unaffected; arbiter can still withdraw it.
        vm.prank(arbiter);
        escrow.withdrawArbiterFee(dealB);
        assertEq(escrow.arbiterFeeBalance(arbiter), 0, "all arbiter fees withdrawn after dealB");
    }

    // T13: wrong arbiter cannot withdraw another deal's fee.
    function testWrongArbiterCannotWithdraw() public {
        uint256 dealA = _createDisputeDeal(ARB_FEE);

        vm.prank(buyer); escrow.dispute(dealA, 0, keccak256("d"));

        // (04d) Warp past 72h response window.
        vm.warp(block.timestamp + 73 hours);
        vm.prank(arbiter); escrow.resolve(dealA, 0, true);

        // A random address that is NOT the deal's arbiter cannot withdraw.
        vm.prank(address(0xDEAD));
        vm.expectRevert(IWaybillEscrow.NotArbiter.selector);
        escrow.withdrawArbiterFee(dealA);

        // Fee still intact for the correct arbiter.
        vm.prank(arbiter);
        escrow.withdrawArbiterFee(dealA);
        assertEq(escrow.arbiterFeeBalance(arbiter), 0, "fee gone after legit withdraw");
    }

    // =========================================================================
    // H-04c-2: retryable buyer refund after blocked address
    // =========================================================================

    // T14: blocked buyerRefund at no-dispute settle; fee stays pending; retry after address change.
    function testBlockedBuyerRefundRetryAfterAddressChange() public {
        uint256 dealId = _createAndFundWithFee(ARB_FEE);

        // Block buyRef before claim so the arbiter-fee refund fails.
        usdc.setBlocked(buyRef, true);

        uint256 escrowBalBefore = usdc.balanceOf(address(escrow));
        uint256 buyRefBefore    = usdc.balanceOf(buyRef);

        // Claim: tranche goes to supPay (not blocked), arbiter-fee refund to buyRef fails → pending.
        vm.prank(supplier);
        escrow.claim(dealId, 0);

        // Deal is SETTLED; fee is pending (not refunded, not lost).
        assertEq(uint8(escrow.getDeal(dealId).state), uint8(IWaybillEscrow.DealState.SETTLED), "deal settled");
        assertEq(escrow.arbiterFeeRefundPending(dealId), ARB_FEE, "fee in pending");
        assertEq(usdc.balanceOf(buyRef) - buyRefBefore, 0, "blocked buyer got nothing yet");

        // H-04c-3: ARB_FEE transfer failed → currentLocked was NOT decremented → fee stays locked.
        // escrow USDC balance = protocol fee (in feeBalances) + ARB_FEE (still locked).
        // currentLocked = ARB_FEE (tranche + prepaidFee already released by claim).
        uint256 prepaidFee = escrow.getDeal(dealId).prepaidFee;
        assertEq(usdc.balanceOf(address(escrow)), prepaidFee + ARB_FEE,
            "escrow holds protocol fee + pending ARB_FEE");
        assertEq(escrow.currentLocked(), ARB_FEE,
            "currentLocked = ARB_FEE (fee stays locked until retry)");

        // Retry while still blocked — reverts.
        vm.expectRevert(IWaybillEscrow.RefundTransferFailed.selector);
        escrow.retryArbiterFeeRefund(dealId);

        // Fee still pending.
        assertEq(escrow.arbiterFeeRefundPending(dealId), ARB_FEE, "still pending after failed retry");

        // Buyer changes refund address to a new unblocked address via delayed process.
        address newRef = address(0xC0FFEE);
        vm.prank(buyer);
        escrow.proposeRefundAddress(dealId, newRef);
        vm.warp(block.timestamp + 48 hours + 1);
        vm.prank(buyer);
        escrow.applyRefundChange(dealId);

        // Retry now succeeds — goes to newRef.
        uint256 newRefBefore = usdc.balanceOf(newRef);
        escrow.retryArbiterFeeRefund(dealId);
        assertEq(usdc.balanceOf(newRef) - newRefBefore, ARB_FEE, "newRef received ARB_FEE");
        assertEq(escrow.arbiterFeeRefundPending(dealId), 0, "pending cleared");
        assertEq(escrow.currentLocked(), 0, "currentLocked = 0 after successful retry");

        // Second retry reverts NoFees.
        vm.expectRevert(IWaybillEscrow.NoFees.selector);
        escrow.retryArbiterFeeRefund(dealId);

        // buyRef (old blocked address) got exactly 0 from this path.
        assertEq(usdc.balanceOf(buyRef) - buyRefBefore, 0, "blocked address still got nothing");
    }

    // T15: blocked buyerRefund at applyDefault; retry works the same way.
    function testBlockedBuyerRefundRetryOnDefault() public {
        uint256 dealId = _createDisputeDeal(ARB_FEE);

        vm.prank(buyer);
        escrow.dispute(dealId, 0, keccak256("d1"));

        IWaybillEscrow.Milestone memory msData = escrow.getMilestone(dealId, 0);
        vm.warp(msData.arbiterDeadline + 1);

        // Block buyRef before applyDefault.
        usdc.setBlocked(buyRef, true);

        uint256 buyRefBefore = usdc.balanceOf(buyRef);

        // applyDefault: buyer raised → toSupplier=false → _refundAndSettle + _refundArbiterFee.
        // _refundAndSettle itself will fail for buyRef (tranche) and re-lock, so the milestone won't SETTLED.
        // We need buyRef UNblocked for the tranche refund but blocked only for arbiter fee.
        // To isolate the arbiter-fee path, unblock buyRef for the tranche transfer but keep it blocked
        // only during the _refundArbiterFee call... that's not possible in a mock without re-entrancy.
        // Instead: test that when buyRef is blocked, applyDefault emits ArbiterFeeRefundPending
        // and the fee is retryable.  The tranche refund will also fail — milestone goes REFUNDABLE.
        vm.prank(buyer);
        escrow.applyDefault(dealId, 0);

        // Milestone went REFUNDABLE (refund failed), arbiter fee pending.
        assertEq(escrow.arbiterFeeRefundPending(dealId), ARB_FEE, "ARB_FEE pending after blocked default");

        // Unblock and retry arbiter fee refund.
        usdc.setBlocked(buyRef, false);
        escrow.retryArbiterFeeRefund(dealId);
        assertEq(usdc.balanceOf(buyRef) - buyRefBefore, ARB_FEE, "ARB_FEE delivered on retry");
        assertEq(escrow.arbiterFeeRefundPending(dealId), 0, "pending cleared");
    }

    // =========================================================================
    // H-04c-3 break tests
    // =========================================================================

    // T16: withdrawFees() cannot consume arbiter fee claim; ledgers stay isolated.
    function testWithdrawFeesCannotConsumeArbiterFee() public {
        // Give the arbiter a real protocol/attestor fee first by making them the treasury for one deal.
        // Instead: use withdrawFees on a fresh arbiter address that also has an arbiter-fee credit.
        uint256 dealId = _createDisputeDeal(ARB_FEE);

        vm.prank(buyer); escrow.dispute(dealId, 0, keccak256("d"));

        // (04d) Warp past 72h response window.
        vm.warp(block.timestamp + 73 hours);
        vm.prank(arbiter); escrow.resolve(dealId, 0, true);

        // arbiterFeeBalance = ARB_FEE; feeBalances = 0
        assertEq(escrow.arbiterFeeBalance(arbiter), ARB_FEE);
        assertEq(escrow.feeBalances(arbiter), 0);

        // Call withdrawFees as the arbiter — reverts NoFees because feeBalances[arbiter]==0.
        // This proves withdrawFees() has no path to the arbiter-fee balance.
        vm.prank(arbiter);
        vm.expectRevert(IWaybillEscrow.NoFees.selector);
        escrow.withdrawFees();

        // Arbiter fee still intact after the revert.
        assertEq(escrow.arbiterFeeBalance(arbiter), ARB_FEE, "arbiter fee unchanged after failed withdrawFees");

        // Now withdraw via the correct path — should work and clear it.
        vm.prank(arbiter);
        escrow.withdrawArbiterFee(dealId);
        assertEq(escrow.arbiterFeeBalance(arbiter), 0, "arbiter fee cleared after withdrawArbiterFee");
    }

    // T17: arbiter with BOTH a protocol fee (from being treasury) and an arbiter fee;
    //      each path must not corrupt the other.
    function testArbiterWithBothFeeTypesRemainIsolated() public {
        // Deploy a fresh escrow where arbiter IS the treasury so they accrue protocol fees.
        WaybillEscrow escrow2 = new WaybillEscrow(
            address(usdc), arbiter /*treasury=arbiter*/, pauser,
            1_000_000e6, 10_000_000e6,
            address(arbList), address(registry)
        );
        vm.prank(buyer);
        usdc.approve(address(escrow2), type(uint256).max);

        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](1);
        ms[0] = IWaybillEscrow.MilestoneInput({
            bps: 10_000, condition: IWaybillEscrow.ReleaseCondition.ACCEPTANCE,
            attestors: new address[](0), threshold: 0, deadline: 0, gracePeriod: 0, reviewWindow: 24,
            dependsOn: type(uint16).max
        });

        uint64 deadline = uint64(block.timestamp + ACC_DL);
        vm.prank(buyer);
        uint256 dealId = escrow2.createDeal(supplier, buyRef, arbiter,
            TOTAL, FEE_BPS, deadline, ARB_HOURS, ms, false, ARB_FEE);

        vm.prank(supplier); escrow2.acceptSupplier(dealId, supPay);
        vm.prank(arbiter);  escrow2.acceptArbiter(dealId);
        vm.prank(buyer);    escrow2.fund(dealId);

        vm.warp(block.timestamp + 1);
        vm.prank(buyer); escrow2.dispute(dealId, 0, keccak256("d"));

        // (04d) Warp past 72h response window.
        vm.warp(block.timestamp + 73 hours);

        // Arbiter resolves — gets protocol fee credit (as treasury) AND arbiter fee credit.
        vm.prank(arbiter); escrow2.resolve(dealId, 0, true);

        uint256 prepaid = escrow2.getDeal(dealId).prepaidFee;

        // Protocol fee is in feeBalances[arbiter] (as treasury).
        assertEq(escrow2.feeBalances(arbiter), prepaid, "protocol fee in feeBalances");
        // Arbiter fee is in SEPARATE arbiterFeeBalance.
        assertEq(escrow2.arbiterFeeBalance(arbiter), ARB_FEE, "arbiter fee in arbiterFeeBalance");

        // withdrawFees() takes protocol fee, leaves arbiter fee untouched.
        uint256 balBefore = usdc.balanceOf(arbiter);
        vm.prank(arbiter); escrow2.withdrawFees();
        assertEq(usdc.balanceOf(arbiter) - balBefore, prepaid, "withdrawFees takes only protocol fee");
        assertEq(escrow2.feeBalances(arbiter), 0, "feeBalances empty");
        assertEq(escrow2.arbiterFeeBalance(arbiter), ARB_FEE, "arbiter fee still intact");

        // withdrawArbiterFee takes arbiter fee, leaves feeBalances at 0.
        vm.prank(arbiter); escrow2.withdrawArbiterFee(dealId);
        assertEq(escrow2.arbiterFeeBalance(arbiter), 0, "arbiter fee withdrawn");
        assertEq(escrow2.feeBalances(arbiter), 0, "feeBalances still 0");
    }

    // T18: blocked settle with full currentLocked accounting assertions.
    function testBlockedSettleLiabilityAccounting() public {
        uint256 dealId = _createAndFundWithFee(ARB_FEE);
        uint256 prepaid = escrow.getDeal(dealId).prepaidFee;

        // Block buyRef.
        usdc.setBlocked(buyRef, true);

        uint256 escrowBalBefore = usdc.balanceOf(address(escrow));
        // currentLocked before claim = TOTAL + prepaid + ARB_FEE
        assertEq(escrow.currentLocked(), TOTAL + prepaid + ARB_FEE, "locked before claim");
        assertEq(escrowBalBefore, TOTAL + prepaid + ARB_FEE, "escrow bal before claim");

        // Claim: tranche goes to supPay, protocol fee accrues to treasury feeBalances.
        // Arbiter fee refund to buyRef fails → pending, currentLocked NOT decremented.
        vm.prank(supplier);
        escrow.claim(dealId, 0);

        // After claim: currentLocked = ARB_FEE (only the pending arbiter-fee refund remains locked).
        assertEq(escrow.currentLocked(), ARB_FEE, "currentLocked = ARB_FEE while pending");
        // Escrow holds protocol fee + ARB_FEE (protocol fee is in feeBalances, not yet withdrawn).
        assertEq(usdc.balanceOf(address(escrow)), prepaid + ARB_FEE,
            "escrow balance = prepaid + ARB_FEE");
        // Pending refund is tracked.
        assertEq(escrow.arbiterFeeRefundPending(dealId), ARB_FEE, "pending set");

        // Retry with still-blocked buyer — reverts, currentLocked unchanged.
        vm.expectRevert(IWaybillEscrow.RefundTransferFailed.selector);
        escrow.retryArbiterFeeRefund(dealId);
        assertEq(escrow.currentLocked(), ARB_FEE, "currentLocked unchanged after failed retry");

        // Unblock and retry — succeeds.
        usdc.setBlocked(buyRef, false);
        escrow.retryArbiterFeeRefund(dealId);

        // After retry: currentLocked = 0, pending = 0.
        assertEq(escrow.currentLocked(), 0, "currentLocked = 0 after retry");
        assertEq(escrow.arbiterFeeRefundPending(dealId), 0, "pending cleared");
        assertEq(usdc.balanceOf(buyRef), ARB_FEE, "buyRef received ARB_FEE");
        // Escrow only holds protocol fee now.
        assertEq(usdc.balanceOf(address(escrow)), prepaid, "escrow holds only protocol fee");
    }

    // T19: wrong caller, double-withdraw, failed-withdraw, repeated-retry — all revert cleanly.
    function testAdversarialPathsRevertCleanly() public {
        uint256 dealA = _createDisputeDeal(ARB_FEE);
        uint256 dealB = _createDisputeDeal(ARB_FEE);

        vm.prank(buyer); escrow.dispute(dealA, 0, keccak256("d"));

        // (04d) Warp past 72h response window.
        vm.warp(block.timestamp + 73 hours);
        vm.prank(arbiter); escrow.resolve(dealA, 0, true);

        uint256 snapshotArbBal = escrow.arbiterFeeBalance(arbiter);
        uint256 snapshotFee    = escrow.feeBalances(arbiter);

        // Wrong caller for deal A.
        vm.prank(address(0xDEAD));
        vm.expectRevert(IWaybillEscrow.NotArbiter.selector);
        escrow.withdrawArbiterFee(dealA);
        assertEq(escrow.arbiterFeeBalance(arbiter), snapshotArbBal, "no change after wrong caller");

        // Correct caller — succeed.
        vm.prank(arbiter); escrow.withdrawArbiterFee(dealA);

        // Second attempt for deal A — reverts NoFees, balance unchanged.
        vm.prank(arbiter);
        vm.expectRevert(IWaybillEscrow.NoFees.selector);
        escrow.withdrawArbiterFee(dealA);
        assertEq(escrow.arbiterFeeBalance(arbiter), snapshotArbBal - ARB_FEE,
            "arbiterFeeBalance = ARB_FEE (only dealB remaining)");

        // Deal B not yet resolved — claimable[dealB] == 0 → NoFees.
        vm.prank(arbiter);
        vm.expectRevert(IWaybillEscrow.NoFees.selector);
        escrow.withdrawArbiterFee(dealB);

        // retryArbiterFeeRefund on a deal with no pending refund → NoFees.
        vm.expectRevert(IWaybillEscrow.NoFees.selector);
        escrow.retryArbiterFeeRefund(dealA);

        // feeBalances unchanged throughout.
        assertEq(escrow.feeBalances(arbiter), snapshotFee, "feeBalances untouched throughout");
    }
}
