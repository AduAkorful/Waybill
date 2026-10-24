// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test}              from "forge-std/Test.sol";
import {WaybillEscrow}     from "../../src/core/WaybillEscrow.sol";
import {IWaybillEscrow}    from "../../src/interfaces/IWaybillEscrow.sol";
import {ArbiterList}       from "../../src/registry/ArbiterList.sol";
import {AttestorRegistry}  from "../../src/registry/AttestorRegistry.sol";

// ---------------------------------------------------------------------------
// Minimal ERC-20 mock (duplicate-free: named distinctly per file)
// ---------------------------------------------------------------------------
contract MockUSDC03k {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external { balanceOf[to] += amount; }

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

// ---------------------------------------------------------------------------
// Reverting registry — used to verify H-1: registry revert must not block payout
// ---------------------------------------------------------------------------
contract RevertingRegistry {
    function recordOutcome(address, uint8) external pure {
        revert("registry down");
    }
    // needed so WaybillEscrow constructor accepts it as a contract
    function addWriter(address) external {}
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------
contract CancelUnaccepted03k is Test {
    uint256 constant USDC_6  = 1e6;
    uint16  constant FEE_BPS = 100; // 1 % — easy integer arithmetic

    MockUSDC03k    internal usdc;
    WaybillEscrow  internal escrow;
    ArbiterList    internal list;
    AttestorRegistry internal reg;

    address internal pauser   = address(0xAA);
    address internal treasury = address(0xBB);
    address internal arbiter  = address(0xCC);
    address internal buyer    = address(0xDD);
    address internal supplier = address(0xEE);
    address internal supPay   = address(0xE1);
    address internal buyRef   = address(0xE2);
    address internal attAddr  = address(0xE3);

    function setUp() public {
        usdc = new MockUSDC03k();
        address[] memory initArbs = new address[](1);
        initArbs[0] = arbiter;
        list = new ArbiterList(pauser, initArbs);
        reg  = new AttestorRegistry(pauser);

        vm.prank(pauser);
        escrow = new WaybillEscrow(
            address(usdc), treasury, pauser,
            100_000 * USDC_6, 1_000_000 * USDC_6,
            address(list), address(reg)
        );
        vm.prank(pauser); reg.addWriter(address(escrow));
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    /// Two-milestone fundFirst deal:
    ///   ms[0] = ATTESTATION (50 %), attAddr, deadline in the past by warpOffset
    ///   ms[1] = ACCEPTANCE  (50 %)
    function _createTwoMsFundFirst(uint64 warpOffset)
        internal returns (uint256 dealId, uint256 total, uint256 fee)
    {
        total = 2_000 * USDC_6;
        fee   = (total * FEE_BPS + 9_999) / 10_000;

        address[] memory atts = new address[](1);
        atts[0] = attAddr;

        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](2);
        // ms[0]: ATTESTATION, deadline in past so applyDefault can make it REFUNDABLE
        ms[0] = IWaybillEscrow.MilestoneInput({
            bps: 5_000,
            condition: IWaybillEscrow.ReleaseCondition.ATTESTATION,
            attestors: atts,
            threshold: 1,
            deadline: uint64(block.timestamp + 1),  // near-future; warp past it
            gracePeriod: 0,                          // no grace: overdue immediately
            reviewWindow: 0,
            dependsOn: type(uint16).max
        });
        // ms[1]: ACCEPTANCE, long deadline
        ms[1] = IWaybillEscrow.MilestoneInput({
            bps: 5_000,
            condition: IWaybillEscrow.ReleaseCondition.ACCEPTANCE,
            attestors: new address[](0),
            threshold: 0,
            deadline: uint64(block.timestamp + 30 days),
            gracePeriod: 0,
            reviewWindow: 0,
            dependsOn: type(uint16).max
        });

        vm.prank(buyer);
        dealId = escrow.createDeal(
            supplier, buyRef, arbiter, total, FEE_BPS,
            uint64(block.timestamp + 14 days), 24, ms, true
        );

        // Fund immediately (fundFirst — no accepts required yet)
        usdc.mint(buyer, total + fee);
        vm.startPrank(buyer);
        usdc.approve(address(escrow), total + fee);
        escrow.fund(dealId);
        vm.stopPrank();

        if (warpOffset > 0) vm.warp(block.timestamp + warpOffset);
    }

    // -------------------------------------------------------------------------
    // Test C-1a: 04e cascade — refunding ms[0] sweeps ms[1] in the same tx
    //
    // 04e invariant: refund(ms[0]) cascades to all non-disputed later milestones,
    // so the total amount returned to the buyer is tranche0+fee0 + tranche1+fee1,
    // not just tranche0+fee0.  The deal settles immediately — cancelUnaccepted is
    // no longer needed (and would revert InvalidDealState if called anyway).
    // A second funded deal's currentLocked is not touched.
    // -------------------------------------------------------------------------
    function testCancelPartial_refundedTranche_exactRemaining() public {
        // Create a second funded deal first so currentLocked is non-zero from it
        uint256 totalB = 1_000 * USDC_6;
        uint256 feeB   = (totalB * FEE_BPS + 9_999) / 10_000;
        {
            IWaybillEscrow.MilestoneInput[] memory ms2 = new IWaybillEscrow.MilestoneInput[](1);
            ms2[0] = IWaybillEscrow.MilestoneInput({
                bps: 10_000,
                condition: IWaybillEscrow.ReleaseCondition.ACCEPTANCE,
                attestors: new address[](0),
                threshold: 0,
                deadline: uint64(block.timestamp + 60 days),
                gracePeriod: 0,
                reviewWindow: 0,
            dependsOn: type(uint16).max
            });
            address buyer2    = address(0xF1);
            address supplier2 = address(0xF2);
            address supPay2   = address(0xF3);
            address buyRef2   = address(0xF4);

            usdc.mint(buyer2, totalB + feeB);
            vm.prank(buyer2);
            uint256 dealB = escrow.createDeal(
                supplier2, buyRef2, arbiter, totalB, FEE_BPS,
                uint64(block.timestamp + 7 days), 24, ms2
            );
            vm.prank(supplier2); escrow.acceptSupplier(dealB, supPay2);
            vm.prank(arbiter);   escrow.acceptArbiter(dealB);
            vm.startPrank(buyer2);
            usdc.approve(address(escrow), totalB + feeB);
            escrow.fund(dealB);
            vm.stopPrank();
        }

        // Create the 2-ms fundFirst deal; warp 2 seconds so ms[0] deadline (now+1) is past
        (uint256 dealId, uint256 total, uint256 fee) = _createTwoMsFundFirst(2);

        // ms[0] bps = 5000, ms[1] bps = 5000
        uint256 tranche0 = total / 2;
        uint256 fee0     = escrow.getTrancheFee(dealId, 0);
        uint256 tranche1 = total - tranche0;  // remainder (last ms)
        uint256 fee1     = fee - fee0;
        uint256 dealBLocked = totalB + feeB;

        // applyDefault on ms[0]: now overdue, grace=0 => REFUNDABLE
        escrow.applyDefault(dealId, 0);
        assertEq(uint8(escrow.getMilestone(dealId, 0).state),
                 uint8(IWaybillEscrow.MilestoneState.REFUNDABLE), "ms0 REFUNDABLE");

        uint256 lockedBefore   = escrow.currentLocked();
        uint256 buyRefBefore   = usdc.balanceOf(buyRef);
        uint256 escrowBefore   = usdc.balanceOf(address(escrow));

        // 04e: refund(ms[0]) cascades and sweeps ms[1] (CLAIMABLE/ACCEPTANCE) in the same tx
        escrow.refund(dealId, 0);

        // Both milestones REFUNDED
        assertEq(uint8(escrow.getMilestone(dealId, 0).state),
                 uint8(IWaybillEscrow.MilestoneState.REFUNDED), "ms0 REFUNDED");
        assertEq(uint8(escrow.getMilestone(dealId, 1).state),
                 uint8(IWaybillEscrow.MilestoneState.REFUNDED), "ms1 cascaded REFUNDED");

        // Buyer received both tranches + both fees
        uint256 expectedTotal = (tranche0 + fee0) + (tranche1 + fee1);
        assertEq(usdc.balanceOf(buyRef) - buyRefBefore, expectedTotal,
                 "buyer received ms0+ms1 in one cascade");

        // Escrow drained by exactly total+fee for this deal
        assertEq(escrowBefore - usdc.balanceOf(address(escrow)), expectedTotal,
                 "escrow drained by ms0+ms1");

        // currentLocked back to just dealB (deal A is SETTLED)
        assertEq(escrow.currentLocked(), dealBLocked, "dealA currentLocked released");
        assertEq(lockedBefore - escrow.currentLocked(),
                 expectedTotal, "locked delta = ms0+ms1");

        // Deal SETTLED (all milestones terminal)
        assertEq(uint8(escrow.getDeal(dealId).state),
                 uint8(IWaybillEscrow.DealState.SETTLED), "deal SETTLED via cascade");

        // cancelUnaccepted now reverts because the deal is already SETTLED
        vm.warp(block.timestamp + 15 days);
        vm.expectRevert(IWaybillEscrow.InvalidDealState.selector);
        escrow.cancelUnaccepted(dealId);
    }

    // -------------------------------------------------------------------------
    // Test C-1b: happy path — no tranche moved; cancel returns totalAmount+prepaidFee
    // -------------------------------------------------------------------------
    function testCancelHappyPath_noTrancheMoved_fullRefund() public {
        uint256 total = 1_000 * USDC_6;
        uint256 fee   = (total * FEE_BPS + 9_999) / 10_000;

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

        usdc.mint(buyer, total + fee);
        vm.prank(buyer);
        uint256 dealId = escrow.createDeal(
            supplier, buyRef, arbiter, total, FEE_BPS,
            uint64(block.timestamp + 7 days), 24, ms, true
        );

        vm.startPrank(buyer);
        usdc.approve(address(escrow), total + fee);
        escrow.fund(dealId);
        vm.stopPrank();

        vm.warp(block.timestamp + 8 days); // past acceptance deadline

        uint256 buyRefBefore = usdc.balanceOf(buyRef);
        escrow.cancelUnaccepted(dealId);

        // Must get back exact totalAmount + prepaidFee
        assertEq(usdc.balanceOf(buyRef) - buyRefBefore, total + fee, "full refund on no-tranche cancel");
        assertEq(escrow.currentLocked(), 0, "nothing locked after full cancel");
        assertEq(uint8(escrow.getDeal(dealId).state),
                 uint8(IWaybillEscrow.DealState.CANCELLED), "CANCELLED");
    }

    // -------------------------------------------------------------------------
    // Test C-1c: cancel reverts when a milestone is DISPUTED
    // -------------------------------------------------------------------------
    function testCancelRevertsIfDisputedMilestone() public {
        // 2-ms fundFirst deal; warp ms[0] to OVERDUE; raise a supplier dispute
        // (supplier disputes OVERDUE milestone within grace — but grace=0 here,
        //  so we need grace > 0 for the supplier to dispute within it).
        //
        // Instead: put ms[0] in IN_REVIEW, let buyer dispute it.
        uint256 total = 1_000 * USDC_6;
        uint256 fee   = (total * FEE_BPS + 9_999) / 10_000;

        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](2);
        // ms[0]: ACCEPTANCE with reviewWindow so it goes IN_REVIEW on fund
        ms[0] = IWaybillEscrow.MilestoneInput({
            bps: 5_000,
            condition: IWaybillEscrow.ReleaseCondition.ACCEPTANCE,
            attestors: new address[](0),
            threshold: 0,
            deadline: uint64(block.timestamp + 30 days),
            gracePeriod: 0,
            reviewWindow: 48, // 48h review window — goes IN_REVIEW on fund
            dependsOn: type(uint16).max
        });
        ms[1] = IWaybillEscrow.MilestoneInput({
            bps: 5_000,
            condition: IWaybillEscrow.ReleaseCondition.ACCEPTANCE,
            attestors: new address[](0),
            threshold: 0,
            deadline: uint64(block.timestamp + 30 days),
            gracePeriod: 0,
            reviewWindow: 0,
            dependsOn: type(uint16).max
        });

        usdc.mint(buyer, total + fee);
        vm.prank(buyer);
        uint256 dealId = escrow.createDeal(
            supplier, buyRef, arbiter, total, FEE_BPS,
            uint64(block.timestamp + 3 days), 24, ms, true
        );

        vm.startPrank(buyer);
        usdc.approve(address(escrow), total + fee);
        escrow.fund(dealId);
        vm.stopPrank();

        // ms[0] is IN_REVIEW — buyer can dispute it
        assertEq(uint8(escrow.getMilestone(dealId, 0).state),
                 uint8(IWaybillEscrow.MilestoneState.IN_REVIEW), "ms0 IN_REVIEW");

        vm.prank(buyer);
        escrow.dispute(dealId, 0, bytes32("evidence"));

        assertEq(uint8(escrow.getMilestone(dealId, 0).state),
                 uint8(IWaybillEscrow.MilestoneState.DISPUTED), "ms0 DISPUTED");

        // Warp past acceptance deadline
        vm.warp(block.timestamp + 4 days);

        // cancelUnaccepted must revert Disputed()
        vm.expectRevert(IWaybillEscrow.Disputed.selector);
        escrow.cancelUnaccepted(dealId);
    }

    // -------------------------------------------------------------------------
    // Test H-1: reverting registry must not block payout
    //
    // Deploy escrow pointing at a registry that always reverts recordOutcome.
    // Fund a deal with ATTESTATION milestone, attest it (threshold met),
    // claim — payout must succeed, RegistryWriteFailed event emitted.
    // -------------------------------------------------------------------------
    function testH1_revertingRegistryDoesNotBlockPayout() public {
        // Deploy a reverting registry
        RevertingRegistry badReg = new RevertingRegistry();

        // New escrow pointing at it
        address[] memory initArbs = new address[](1);
        initArbs[0] = arbiter;
        ArbiterList list2 = new ArbiterList(pauser, initArbs);

        vm.prank(pauser);
        WaybillEscrow escrow2 = new WaybillEscrow(
            address(usdc), treasury, pauser,
            100_000 * USDC_6, 1_000_000 * USDC_6,
            address(list2), address(badReg)
        );
        // badReg.addWriter is a no-op; escrow2 will call recordOutcome and it will revert

        // Create 1-ms ATTESTATION deal (attAddr as attestor)
        address[] memory atts = new address[](1);
        atts[0] = attAddr;
        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](1);
        ms[0] = IWaybillEscrow.MilestoneInput({
            bps: 10_000,
            condition: IWaybillEscrow.ReleaseCondition.ATTESTATION,
            attestors: atts,
            threshold: 1,
            deadline: uint64(block.timestamp + 30 days),
            gracePeriod: 0,
            reviewWindow: 0,
            dependsOn: type(uint16).max
        });

        uint256 total = 500 * USDC_6;
        uint256 fee   = (total * FEE_BPS + 9_999) / 10_000;
        usdc.mint(buyer, total + fee);

        vm.prank(buyer);
        uint256 dealId = escrow2.createDeal(
            supplier, buyRef, arbiter, total, FEE_BPS,
            uint64(block.timestamp + 7 days), 24, ms
        );

        vm.prank(supplier); escrow2.acceptSupplier(dealId, supPay);
        vm.prank(arbiter);  escrow2.acceptArbiter(dealId);
        vm.prank(attAddr);  escrow2.acceptAttestor(dealId, 0);

        vm.startPrank(buyer);
        usdc.approve(address(escrow2), total + fee);
        escrow2.fund(dealId);
        vm.stopPrank();

        // Attest via the escrow's ECDSA path — we need a real key for attAddr
        // Use the deal without ECDSA: just prank-call attest with an empty sig
        // and let ERC-1271 path check attAddr (which has no code — revert).
        // Instead we use a separate EOA key.
        (address att2, uint256 att2pk) = makeAddrAndKey("att2");

        // Re-create deal with att2 as attestor
        atts[0] = att2;
        ms[0].attestors = atts;
        usdc.mint(buyer, total + fee);
        vm.prank(buyer);
        uint256 dealId2 = escrow2.createDeal(
            supplier, buyRef, arbiter, total, FEE_BPS,
            uint64(block.timestamp + 7 days), 24, ms
        );
        vm.prank(supplier); escrow2.acceptSupplier(dealId2, supPay);
        vm.prank(arbiter);  escrow2.acceptArbiter(dealId2);
        vm.prank(att2);     escrow2.acceptAttestor(dealId2, 0);

        vm.startPrank(buyer);
        usdc.approve(address(escrow2), total + fee);
        escrow2.fund(dealId2);
        vm.stopPrank();

        // Build attestation signature
        bytes32 evidenceHash = keccak256("evidence");
        uint64  signedAt     = uint64(block.timestamp);
        uint64  expiry       = uint64(block.timestamp + 1 hours);
        address att2addr = vm.addr(att2pk);
        bytes32 structHash   = keccak256(abi.encode(
            escrow2.ATTESTATION_TYPEHASH(),
            dealId2, uint8(0), block.chainid, address(escrow2),
            att2addr,                      // signer field
            escrow2.STATEMENT_VERSION(), evidenceHash, signedAt, expiry
        ));
        bytes32 digest = escrow2.hashTypedDataV4(structHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(att2pk, digest);
        bytes memory sig = abi.encodePacked(r, s, v);

        // Attest — threshold met → milestone goes CLAIMABLE
        escrow2.attest(dealId2, 0, evidenceHash, signedAt, expiry, att2addr, sig);
        assertEq(uint8(escrow2.getMilestone(dealId2, 0).state),
                 uint8(IWaybillEscrow.MilestoneState.CLAIMABLE), "CLAIMABLE");

        // claim — recordOutcome will revert inside the registry; H-1 wraps it
        uint256 supPayBefore = usdc.balanceOf(supPay);

        // Expect RegistryWriteFailed event emitted
        vm.expectEmit(true, true, false, false, address(escrow2));
        emit IWaybillEscrow.RegistryWriteFailed(dealId2, att2);

        escrow2.claim(dealId2, 0);

        // Payout reached supplier despite registry revert
        assertGt(usdc.balanceOf(supPay), supPayBefore, "supplier received payment");
        assertEq(uint8(escrow2.getDeal(dealId2).state),
                 uint8(IWaybillEscrow.DealState.SETTLED), "deal SETTLED");
    }
}
