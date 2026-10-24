// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console2} from "forge-std/Test.sol";
import {WaybillEscrow}     from "../../src/core/WaybillEscrow.sol";
import {IWaybillEscrow}    from "../../src/interfaces/IWaybillEscrow.sol";
import {ArbiterList}       from "../../src/registry/ArbiterList.sol";
import {AttestorRegistry}  from "../../src/registry/AttestorRegistry.sol";
import {BondVault}         from "../../src/vaults/BondVault.sol";
import {FinancingVault}    from "../../src/vaults/FinancingVault.sol";
import {MockUSDC}          from "../integration/WaybillEscrow.t.sol";

// ---------------------------------------------------------------------------
// Fuzz04j — focused fuzz + regression suite
// ---------------------------------------------------------------------------
contract Fuzz04j is Test {

    // ── fixtures ──────────────────────────────────────────────────────────────
    WaybillEscrow      internal escrow;
    MockUSDC           internal usdc;
    ArbiterList        internal list;
    AttestorRegistry   internal reg;
    BondVault          internal bondVault;
    FinancingVault     internal finVault;

    address internal treasury  = address(0x1111);
    address internal pauser    = address(0x2222);

    uint256 internal buyerPk    = 0xB0B;
    uint256 internal supplierPk = 0x5077;
    uint256 internal arbiterPk  = 0xAB1;
    uint256 internal att0Pk     = 0xA110;

    address internal buyer;
    address internal supplier;
    address internal arbiter;
    address internal att0;
    address internal supplierPayout = address(0xAAAA);
    address internal buyerRefund    = address(0xBBBB);

    uint256 internal constant MAX_DEAL   = 100_000e6;
    uint256 internal constant MAX_LOCKED = 10_000_000e6;
    uint16  internal constant FEE_MIN    = 50;
    uint16  internal constant FEE_MAX    = 100;

    // ── setup ─────────────────────────────────────────────────────────────────
    function setUp() public {
        buyer    = vm.addr(buyerPk);
        supplier = vm.addr(supplierPk);
        arbiter  = vm.addr(arbiterPk);
        att0     = vm.addr(att0Pk);

        usdc = new MockUSDC();

        address[] memory initArbiters = new address[](1);
        initArbiters[0] = arbiter;
        list = new ArbiterList(pauser, initArbiters);
        reg  = new AttestorRegistry(pauser);
        escrow = new WaybillEscrow(
            address(usdc), treasury, pauser,
            MAX_DEAL, MAX_LOCKED,
            address(list), address(reg)
        );
        vm.prank(pauser); reg.addWriter(address(escrow));

        bondVault = new BondVault(address(usdc), pauser, address(escrow), address(reg));
        finVault  = new FinancingVault(address(usdc), pauser, address(escrow));
    }

    // ── helpers ───────────────────────────────────────────────────────────────
    function _none() internal pure returns (address[] memory a) { a = new address[](0); }
    function _one(address x) internal pure returns (address[] memory a) {
        a = new address[](1); a[0] = x;
    }

    /// Build a single-milestone ACCEPTANCE deal, fully accepted + funded.
    /// Returns (dealId, totalDeposited).
    function _singleMs(uint256 total, uint16 feeBps)
        internal
        returns (uint256 dealId, uint256 deposited)
    {
        feeBps = uint16(bound(feeBps, FEE_MIN, FEE_MAX));
        total  = bound(total, 1e6, 10_000e6);

        uint256 fee = (total * feeBps + 9_999) / 10_000;
        deposited   = total + fee;

        usdc.mint(buyer, deposited);
        vm.prank(buyer); usdc.approve(address(escrow), type(uint256).max);

        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](1);
        ms[0] = IWaybillEscrow.MilestoneInput({
            bps: 10_000,
            condition: IWaybillEscrow.ReleaseCondition.ACCEPTANCE,
            attestors: _none(), threshold: 0,
            deadline: uint64(block.timestamp + 30 days),
            gracePeriod: 72, reviewWindow: 0,
            dependsOn: type(uint16).max
        });

        vm.prank(buyer);
        dealId = escrow.createDeal(
            supplier, buyerRefund, arbiter,
            total, feeBps,
            uint64(block.timestamp + 7 days), 48,
            ms
        );
        vm.prank(supplier); escrow.acceptSupplier(dealId, supplierPayout);
        vm.prank(arbiter);  escrow.acceptArbiter(dealId);
        vm.prank(buyer);    escrow.fund(dealId);
    }

    // =========================================================================
    // F1 — Invalid bps sums revert; valid sums preserve funded amount + locked
    // =========================================================================

    function testFuzz_F1_InvalidBpsSum_Reverts(uint256 bps0, uint256 bps1) public {
        bps0 = bound(bps0, 1, 10_000);
        bps1 = bound(bps1, 1, 10_000);
        vm.assume(bps0 + bps1 != 10_000); // guarantee invalid sum

        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](2);
        ms[0] = IWaybillEscrow.MilestoneInput({
            bps: bps0, condition: IWaybillEscrow.ReleaseCondition.ACCEPTANCE,
            attestors: _none(), threshold: 0,
            deadline: uint64(block.timestamp + 30 days),
            gracePeriod: 72, reviewWindow: 0, dependsOn: type(uint16).max
        });
        ms[1] = IWaybillEscrow.MilestoneInput({
            bps: bps1, condition: IWaybillEscrow.ReleaseCondition.ACCEPTANCE,
            attestors: _none(), threshold: 0,
            deadline: uint64(block.timestamp + 30 days),
            gracePeriod: 72, reviewWindow: 0, dependsOn: type(uint16).max
        });

        vm.expectRevert(IWaybillEscrow.InvalidBpsSum.selector);
        vm.prank(buyer);
        escrow.createDeal(
            supplier, buyerRefund, arbiter,
            1_000e6, 75,
            uint64(block.timestamp + 7 days), 48,
            ms
        );
    }

    function testFuzz_F1_FundedAmountMatchesLocked(uint256 total, uint16 feeBps) public {
        uint256 lockedBefore  = escrow.currentLocked();
        uint256 escrowBefore  = usdc.balanceOf(address(escrow));
        (uint256 dealId,)     = _singleMs(total, feeBps);
        uint256 lockedAfter   = escrow.currentLocked();
        uint256 escrowAfter   = usdc.balanceOf(address(escrow));

        // Actual deposit = totalAmount + prepaidFee (ceil fee) stored in deal
        IWaybillEscrow.Deal memory d = escrow.getDeal(dealId);
        uint256 actualDeposit = d.totalAmount + d.prepaidFee;

        assertEq(lockedAfter - lockedBefore, actualDeposit,
            "currentLocked must increase by exact deposit amount");
        assertEq(escrowAfter - escrowBefore, actualDeposit,
            "escrow token balance must match locked delta");
    }

    // =========================================================================
    // F2 — Duplicate accept, replay, unauthorized calls must not mutate state
    // =========================================================================

    function testFuzz_F2_DuplicateSupplierAccept_Reverts(uint256 total, uint16 feeBps) public {
        total  = bound(total, 1e6, 10_000e6);
        feeBps = uint16(bound(feeBps, FEE_MIN, FEE_MAX));
        uint256 fee = (total * feeBps + 9_999) / 10_000;
        usdc.mint(buyer, total + fee);
        vm.prank(buyer); usdc.approve(address(escrow), type(uint256).max);

        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](1);
        ms[0] = IWaybillEscrow.MilestoneInput({
            bps: 10_000, condition: IWaybillEscrow.ReleaseCondition.ACCEPTANCE,
            attestors: _none(), threshold: 0,
            deadline: uint64(block.timestamp + 30 days),
            gracePeriod: 72, reviewWindow: 0, dependsOn: type(uint16).max
        });
        vm.prank(buyer);
        uint256 dealId = escrow.createDeal(
            supplier, buyerRefund, arbiter,
            total, feeBps,
            uint64(block.timestamp + 7 days), 48, ms
        );

        vm.prank(supplier); escrow.acceptSupplier(dealId, supplierPayout);

        // Second accept by supplier must revert
        vm.expectRevert(IWaybillEscrow.AlreadyAccepted.selector);
        vm.prank(supplier); escrow.acceptSupplier(dealId, supplierPayout);
    }

    function testFuzz_F2_NonArbiterResolve_Reverts(uint256 total, uint16 feeBps, address attacker) public {
        // Bound inputs; attacker must not be the named arbiter
        total   = bound(total, 1e6, 10_000e6);
        feeBps  = uint16(bound(feeBps, FEE_MIN, FEE_MAX));
        vm.assume(attacker != arbiter && attacker != address(0));

        // Build an ATTESTATION milestone with reviewWindow > 0 so buyer can dispute
        uint256 fee = (total * feeBps + 9_999) / 10_000;
        usdc.mint(buyer, total + fee);
        vm.prank(buyer); usdc.approve(address(escrow), type(uint256).max);

        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](1);
        ms[0] = IWaybillEscrow.MilestoneInput({
            bps: 10_000,
            condition: IWaybillEscrow.ReleaseCondition.ATTESTATION,
            attestors: _one(att0), threshold: 1,
            deadline: uint64(block.timestamp + 30 days),
            gracePeriod: 72,
            reviewWindow: 48,          // > 0 so buyer can dispute from IN_REVIEW
            dependsOn: type(uint16).max
        });
        vm.prank(buyer);
        uint256 dealId = escrow.createDeal(
            supplier, buyerRefund, arbiter,
            total, feeBps,
            uint64(block.timestamp + 7 days), 48, ms
        );
        vm.prank(supplier); escrow.acceptSupplier(dealId, supplierPayout);
        vm.prank(att0);     escrow.acceptAttestor(dealId, 0);
        vm.prank(arbiter);  escrow.acceptArbiter(dealId);
        vm.prank(buyer);    escrow.fund(dealId);

        // Attestor signs and submits attestation → milestone enters IN_REVIEW
        bytes32 evHash   = keccak256("evidence-fuzz-f2");
        uint64  signedAt = uint64(block.timestamp);
        uint64  expiry   = uint64(block.timestamp + 30 days);
        bytes32 structHash = keccak256(abi.encode(
            escrow.ATTESTATION_TYPEHASH(),
            dealId, uint8(0), block.chainid, address(escrow),
            att0,
            escrow.STATEMENT_VERSION(), evHash, signedAt, expiry
        ));
        bytes32 digest = escrow.hashTypedDataV4(structHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(att0Pk, digest);
        bytes memory sig = abi.encodePacked(r, s, v);
        escrow.attest(dealId, 0, evHash, signedAt, expiry, att0, sig);
        // Milestone is now IN_REVIEW; buyer raises dispute
        vm.prank(buyer);
        escrow.dispute(dealId, 0, keccak256("dispute-evidence"));

        // Record pre-attempt state
        uint256 lockedBefore        = escrow.currentLocked();
        uint256 supplierBalBefore   = usdc.balanceOf(supplierPayout);
        uint256 buyerBalBefore      = usdc.balanceOf(buyerRefund);
        uint8   stateBefore         = uint8(escrow.getMilestone(dealId, 0).state);

        // Non-arbiter caller must get NotArbiter
        vm.expectRevert(IWaybillEscrow.NotArbiter.selector);
        vm.prank(attacker);
        escrow.resolve(dealId, 0, true);

        // Nothing changed
        assertEq(escrow.currentLocked(),          lockedBefore,      "F2: locked unchanged");
        assertEq(usdc.balanceOf(supplierPayout),  supplierBalBefore, "F2: supplier bal unchanged");
        assertEq(usdc.balanceOf(buyerRefund),     buyerBalBefore,    "F2: buyer bal unchanged");
        assertEq(uint8(escrow.getMilestone(dealId, 0).state), stateBefore, "F2: state unchanged");
    }

    function testFuzz_F2_UnauthorizedRefund_Reverts(uint256 total, uint16 feeBps) public {
        total  = bound(total, 1e6, 10_000e6);
        feeBps = uint16(bound(feeBps, FEE_MIN, FEE_MAX));
        uint256 fee = (total * feeBps + 9_999) / 10_000;
        usdc.mint(buyer, total + fee);
        vm.prank(buyer); usdc.approve(address(escrow), type(uint256).max);

        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](1);
        ms[0] = IWaybillEscrow.MilestoneInput({
            bps: 10_000, condition: IWaybillEscrow.ReleaseCondition.ATTESTATION,
            attestors: _one(att0), threshold: 1,
            deadline: uint64(block.timestamp + 1 days),
            gracePeriod: 1, reviewWindow: 0, dependsOn: type(uint16).max
        });
        vm.prank(buyer);
        uint256 dealId = escrow.createDeal(
            supplier, buyerRefund, arbiter,
            total, feeBps,
            uint64(block.timestamp + 7 days), 48, ms
        );
        vm.prank(supplier); escrow.acceptSupplier(dealId, supplierPayout);
        vm.prank(att0);     escrow.acceptAttestor(dealId, 0);
        vm.prank(arbiter);  escrow.acceptArbiter(dealId);
        vm.prank(buyer);    escrow.fund(dealId);

        // milestone is WAITING (not REFUNDABLE) — refund must revert
        vm.expectRevert(IWaybillEscrow.NotRefundable.selector);
        vm.prank(address(0xDEAD)); escrow.refund(dealId, 0);
    }

    // =========================================================================
    // F3 — Fee-mode solvency: payout + refund + fee == funded amount
    // =========================================================================

    function testFuzz_F3_BuyerPrepaid_ClaimSolvency(uint256 total, uint16 feeBps) public {
        (uint256 dealId,) = _singleMs(total, feeBps);

        uint256 escrowBefore  = usdc.balanceOf(address(escrow));
        uint256 supplierBefore = usdc.balanceOf(supplierPayout);
        uint256 treasuryFee   = escrow.feeBalance(treasury);

        escrow.claim(dealId, 0);  // anyone can call

        uint256 escrowAfter   = usdc.balanceOf(address(escrow));
        uint256 supplierGot   = usdc.balanceOf(supplierPayout) - supplierBefore;
        uint256 feeCredited   = escrow.feeBalance(treasury) - treasuryFee;

        // Fee stays in escrow (credited to treasury feeBalance, not transferred out yet)
        // So escrow loses only the totalAmount (supplier's payout), not the fee
        IWaybillEscrow.Deal memory dPost = escrow.getDeal(dealId);
        assertEq(escrowBefore - escrowAfter, dPost.totalAmount,
            "BP: escrow delta == totalAmount (fee stays in escrow)");
        // Supplier gets full principal
        assertEq(supplierGot, dPost.totalAmount,
            "BP: supplier got full principal");
        // Fee credited matches the tranche fee from storage
        assertEq(feeCredited, escrow.getTrancheFee(dealId, 0),
            "BP: fee credited == trancheFee");
        // currentLocked back to pre-fund level
        assertEq(escrow.currentLocked(), 0,
            "BP: locked zero after settle");
    }

    function testFuzz_F3_SupplierDeducted_ClaimSolvency(uint256 total, uint16 feeBps) public {
        feeBps = uint16(bound(feeBps, FEE_MIN, FEE_MAX));
        total  = bound(total, 1e6, 10_000e6);

        // SupplierDeducted: buyer funds principal only
        uint256 deposited = total; // no fee prepaid
        usdc.mint(buyer, deposited);
        vm.prank(buyer); usdc.approve(address(escrow), type(uint256).max);

        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](1);
        ms[0] = IWaybillEscrow.MilestoneInput({
            bps: 10_000, condition: IWaybillEscrow.ReleaseCondition.ACCEPTANCE,
            attestors: _none(), threshold: 0,
            deadline: uint64(block.timestamp + 30 days),
            gracePeriod: 72, reviewWindow: 0, dependsOn: type(uint16).max
        });

        vm.prank(buyer);
        uint256 dealId = escrow.createDeal(
            supplier, buyerRefund, arbiter,
            total, feeBps,
            uint64(block.timestamp + 7 days), 48,
            ms, false, 0,
            IWaybillEscrow.FeePayer.SupplierDeducted
        );
        vm.prank(supplier); escrow.acceptSupplier(dealId, supplierPayout);
        vm.prank(arbiter);  escrow.acceptArbiter(dealId);
        vm.prank(buyer);    escrow.fund(dealId);

        uint256 trancheFee     = escrow.getTrancheFee(dealId, 0); // exact from storage
        uint256 escrowBefore   = usdc.balanceOf(address(escrow));
        uint256 supplierBefore = usdc.balanceOf(supplierPayout);
        uint256 treasuryBefore = escrow.feeBalance(treasury);

        escrow.claim(dealId, 0);

        uint256 escrowAfter  = usdc.balanceOf(address(escrow));
        uint256 supplierGot  = usdc.balanceOf(supplierPayout) - supplierBefore;
        uint256 feeCredited  = escrow.feeBalance(treasury) - treasuryBefore;

        // Escrow lost total - trancheFee (fee USDC stays in escrow pending treasury withdrawal)
        assertEq(escrowBefore - escrowAfter, total - trancheFee,
            "SD: escrow delta == total - trancheFee");
        // Supplier got tranche - fee
        assertEq(supplierGot, total - trancheFee,
            "SD: supplier got tranche - trancheFee");
        // Fee credited == trancheFee
        assertEq(feeCredited, trancheFee,
            "SD: fee credited == trancheFee");
        // Locked zero
        assertEq(escrow.currentLocked(), 0,
            "SD: locked zero after settle");
    }

    function testFuzz_F3_Split_ClaimSolvency(uint256 total, uint16 feeBps) public {
        feeBps = uint16(bound(feeBps, FEE_MIN, FEE_MAX));
        total  = bound(total, 2e6, 10_000e6); // ensure fee rounds cleanly

        uint256 fee         = (total * feeBps + 9_999) / 10_000;
        uint256 buyerHalf   = (fee + 1) / 2; // ceil
        uint256 deposited   = total + buyerHalf;

        usdc.mint(buyer, deposited);
        vm.prank(buyer); usdc.approve(address(escrow), type(uint256).max);

        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](1);
        ms[0] = IWaybillEscrow.MilestoneInput({
            bps: 10_000, condition: IWaybillEscrow.ReleaseCondition.ACCEPTANCE,
            attestors: _none(), threshold: 0,
            deadline: uint64(block.timestamp + 30 days),
            gracePeriod: 72, reviewWindow: 0, dependsOn: type(uint16).max
        });

        vm.prank(buyer);
        uint256 dealId = escrow.createDeal(
            supplier, buyerRefund, arbiter,
            total, feeBps,
            uint64(block.timestamp + 7 days), 48,
            ms, false, 0,
            IWaybillEscrow.FeePayer.Split
        );
        vm.prank(supplier); escrow.acceptSupplier(dealId, supplierPayout);
        vm.prank(arbiter);  escrow.acceptArbiter(dealId);
        vm.prank(buyer);    escrow.fund(dealId);

        // Use exact values from contract storage to avoid floor/ceil mismatch
        uint256 trancheFee   = escrow.getTrancheFee(dealId, 0);
        IWaybillEscrow.Deal memory d = escrow.getDeal(dealId);
        uint256 actualDeposit = d.totalAmount + d.prepaidFee;
        uint256 escrowBefore  = usdc.balanceOf(address(escrow));
        uint256 supplierBefore = usdc.balanceOf(supplierPayout);
        uint256 treasuryBefore = escrow.feeBalance(treasury);

        escrow.claim(dealId, 0);

        uint256 escrowAfter = usdc.balanceOf(address(escrow));
        uint256 supplierGot = usdc.balanceOf(supplierPayout) - supplierBefore;
        uint256 feeCredited = escrow.feeBalance(treasury) - treasuryBefore;
        uint256 supplierDeducted = trancheFee - d.prepaidFee; // supplier's half

        // Escrow loses only what is transferred out (supplier's net payout).
        // The trancheFee stays in escrow credited to treasury feeBalance.
        // supplierDeducted = trancheFee - d.prepaidFee = supplier's half of fee
        // escrow out = d.totalAmount - supplierDeducted  (the supplier payout transfer)
        assertEq(escrowBefore - escrowAfter, d.totalAmount - supplierDeducted,
            "SP: escrow delta == totalAmount - supplierDeducted");
        // Supplier got tranche - supplierDeducted
        assertEq(supplierGot, d.totalAmount - supplierDeducted,
            "SP: supplier got tranche - supplierDeducted");
        // Fee credited == full trancheFee
        assertEq(feeCredited, trancheFee,
            "SP: fee credited == trancheFee");
        // Solvency: what supplier got + fee credited == actualDeposit
        assertEq(supplierGot + feeCredited, actualDeposit,
            "SP: solvency supplierGot + feeCredited == actualDeposit");
        assertEq(escrow.currentLocked(), 0, "SP: locked zero");
    }

    function testFuzz_F3_Split_RefundSolvency(uint256 total, uint16 feeBps) public {
        feeBps = uint16(bound(feeBps, FEE_MIN, FEE_MAX));
        total  = bound(total, 2e6, 10_000e6);

        uint256 fee       = (total * feeBps + 9_999) / 10_000;
        uint256 buyerHalf = (fee + 1) / 2;
        uint256 deposited = total + buyerHalf;

        usdc.mint(buyer, deposited);
        vm.prank(buyer); usdc.approve(address(escrow), type(uint256).max);

        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](1);
        ms[0] = IWaybillEscrow.MilestoneInput({
            bps: 10_000, condition: IWaybillEscrow.ReleaseCondition.ATTESTATION,
            attestors: _one(att0), threshold: 1,
            deadline: uint64(block.timestamp + 1 days),
            gracePeriod: 1, reviewWindow: 0, dependsOn: type(uint16).max
        });

        vm.prank(buyer);
        uint256 dealId = escrow.createDeal(
            supplier, buyerRefund, arbiter,
            total, feeBps,
            uint64(block.timestamp + 7 days), 48,
            ms, false, 0,
            IWaybillEscrow.FeePayer.Split
        );
        vm.prank(supplier); escrow.acceptSupplier(dealId, supplierPayout);
        vm.prank(att0);     escrow.acceptAttestor(dealId, 0);
        vm.prank(arbiter);  escrow.acceptArbiter(dealId);
        vm.prank(buyer);    escrow.fund(dealId);

        // Let milestone go OVERDUE then REFUNDABLE
        vm.warp(block.timestamp + 1 days + 1 hours + 2);
        escrow.applyDefault(dealId, 0);

        uint256 refundBefore = usdc.balanceOf(buyerRefund);
        escrow.refund(dealId, 0);
        uint256 refundGot = usdc.balanceOf(buyerRefund) - refundBefore;

        // Buyer gets back principal + buyerHalf
        assertEq(refundGot, total + buyerHalf,
            "SP refund: buyer gets principal + buyerHalf");
        assertEq(escrow.currentLocked(), 0, "SP refund: locked zero");
    }

    // =========================================================================
    // F4 — Pause blocks create/fund only; other operations remain available
    // =========================================================================

    function testFuzz_F4_PauseBlocksCreateFund(uint256 total, uint16 feeBps) public {
        total  = bound(total, 1e6, 10_000e6);
        feeBps = uint16(bound(feeBps, FEE_MIN, FEE_MAX));
        uint256 fee = (total * feeBps + 9_999) / 10_000;
        usdc.mint(buyer, (total + fee) * 2);
        vm.prank(buyer); usdc.approve(address(escrow), type(uint256).max);

        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](1);
        ms[0] = IWaybillEscrow.MilestoneInput({
            bps: 10_000, condition: IWaybillEscrow.ReleaseCondition.ACCEPTANCE,
            attestors: _none(), threshold: 0,
            deadline: uint64(block.timestamp + 30 days),
            gracePeriod: 72, reviewWindow: 0, dependsOn: type(uint16).max
        });

        // Create a deal before pausing
        vm.prank(buyer);
        uint256 dealId = escrow.createDeal(
            supplier, buyerRefund, arbiter,
            total, feeBps,
            uint64(block.timestamp + 7 days), 48, ms
        );
        vm.prank(supplier); escrow.acceptSupplier(dealId, supplierPayout);
        vm.prank(arbiter);  escrow.acceptArbiter(dealId);

        // Pause
        vm.prank(pauser); escrow.pauseNewDeals();

        // createDeal must revert
        vm.expectRevert(IWaybillEscrow.NewDealsPausedError.selector);
        vm.prank(buyer);
        escrow.createDeal(
            supplier, buyerRefund, arbiter,
            total, feeBps,
            uint64(block.timestamp + 7 days), 48, ms
        );

        // fund must revert
        vm.expectRevert(IWaybillEscrow.NewDealsPausedError.selector);
        vm.prank(buyer); escrow.fund(dealId);

        // Unpause — fund now works
        vm.prank(pauser); escrow.unpauseNewDeals();
        vm.prank(buyer); escrow.fund(dealId);
        assertEq(
            uint8(escrow.getDeal(dealId).state),
            uint8(IWaybillEscrow.DealState.FUNDED),
            "F4: deal funded after unpause"
        );
    }

    function testFuzz_F4_PauseDoesNotBlockClaim(uint256 total, uint16 feeBps) public {
        (uint256 dealId,) = _singleMs(total, feeBps);

        vm.prank(pauser); escrow.pauseNewDeals();

        // claim must succeed even while paused
        uint256 before = usdc.balanceOf(supplierPayout);
        escrow.claim(dealId, 0);
        assertGt(usdc.balanceOf(supplierPayout), before,
            "F4: claim works while paused");
    }

    function testFuzz_F4_PauseDoesNotBlockRefund(uint256 total, uint16 feeBps) public {
        total  = bound(total, 1e6, 10_000e6);
        feeBps = uint16(bound(feeBps, FEE_MIN, FEE_MAX));
        uint256 fee = (total * feeBps + 9_999) / 10_000;
        usdc.mint(buyer, total + fee);
        vm.prank(buyer); usdc.approve(address(escrow), type(uint256).max);

        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](1);
        ms[0] = IWaybillEscrow.MilestoneInput({
            bps: 10_000, condition: IWaybillEscrow.ReleaseCondition.ATTESTATION,
            attestors: _one(att0), threshold: 1,
            deadline: uint64(block.timestamp + 1 days),
            gracePeriod: 1, reviewWindow: 0, dependsOn: type(uint16).max
        });
        vm.prank(buyer);
        uint256 dealId = escrow.createDeal(
            supplier, buyerRefund, arbiter,
            total, feeBps,
            uint64(block.timestamp + 7 days), 48, ms
        );
        vm.prank(supplier); escrow.acceptSupplier(dealId, supplierPayout);
        vm.prank(att0);     escrow.acceptAttestor(dealId, 0);
        vm.prank(arbiter);  escrow.acceptArbiter(dealId);
        vm.prank(buyer);    escrow.fund(dealId);

        vm.warp(block.timestamp + 1 days + 1 hours + 2);
        escrow.applyDefault(dealId, 0);

        // Pause — refund must still work
        vm.prank(pauser); escrow.pauseNewDeals();

        uint256 before = usdc.balanceOf(buyerRefund);
        escrow.refund(dealId, 0);
        assertGt(usdc.balanceOf(buyerRefund), before,
            "F4: refund works while paused");
    }

    function testFuzz_F4_PauseDoesNotBlockFeeWithdrawal(uint256 total, uint16 feeBps) public {
        (uint256 dealId,) = _singleMs(total, feeBps);
        escrow.claim(dealId, 0);  // credits fees to treasury

        uint256 feeAmt = escrow.feeBalance(treasury);
        vm.assume(feeAmt > 0);

        vm.prank(pauser); escrow.pauseNewDeals();

        // treasury can withdraw fees while paused
        uint256 before = usdc.balanceOf(treasury);
        vm.prank(treasury); escrow.withdrawFees();
        assertGt(usdc.balanceOf(treasury), before,
            "F4: fee withdrawal works while paused");
    }

    // =========================================================================
    // F5 — Blocked recipient: delivery retryable, not final
    // =========================================================================

    function testFuzz_F5_BlockedRefund_IsRetryable(uint256 total, uint16 feeBps) public {
        total  = bound(total, 1e6, 10_000e6);
        feeBps = uint16(bound(feeBps, FEE_MIN, FEE_MAX));
        uint256 fee = (total * feeBps + 9_999) / 10_000;
        usdc.mint(buyer, total + fee);
        vm.prank(buyer); usdc.approve(address(escrow), type(uint256).max);

        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](1);
        ms[0] = IWaybillEscrow.MilestoneInput({
            bps: 10_000, condition: IWaybillEscrow.ReleaseCondition.ATTESTATION,
            attestors: _one(att0), threshold: 1,
            deadline: uint64(block.timestamp + 1 days),
            gracePeriod: 1, reviewWindow: 0, dependsOn: type(uint16).max
        });
        vm.prank(buyer);
        uint256 dealId = escrow.createDeal(
            supplier, buyerRefund, arbiter,
            total, feeBps,
            uint64(block.timestamp + 7 days), 48, ms
        );
        vm.prank(supplier); escrow.acceptSupplier(dealId, supplierPayout);
        vm.prank(att0);     escrow.acceptAttestor(dealId, 0);
        vm.prank(arbiter);  escrow.acceptArbiter(dealId);
        vm.prank(buyer);    escrow.fund(dealId);

        // Block buyerRefund
        usdc.setBlocked(buyerRefund, true);

        // Make milestone refundable
        vm.warp(block.timestamp + 1 days + 1 hours + 2);
        escrow.applyDefault(dealId, 0);

        uint256 lockedBefore = escrow.currentLocked();

        // refund call emits RefundFailed but doesn't revert
        escrow.refund(dealId, 0);

        // Milestone must be REFUNDABLE (non-terminal), currentLocked unchanged
        assertEq(
            uint8(escrow.getMilestone(dealId, 0).state),
            uint8(IWaybillEscrow.MilestoneState.REFUNDABLE),
            "F5: milestone stays REFUNDABLE after failed refund"
        );
        assertEq(escrow.currentLocked(), lockedBefore,
            "F5: currentLocked unchanged after blocked refund");

        // Unblock and retry
        usdc.setBlocked(buyerRefund, false);
        uint256 before = usdc.balanceOf(buyerRefund);
        escrow.refund(dealId, 0);
        assertGt(usdc.balanceOf(buyerRefund), before,
            "F5: retry delivers after unblock");
        assertEq(
            uint8(escrow.getMilestone(dealId, 0).state),
            uint8(IWaybillEscrow.MilestoneState.REFUNDED),
            "F5: milestone REFUNDED after retry"
        );
    }

    function testFuzz_F5_BlockedCascade_IsRetryable(uint256 total, uint16 feeBps) public {
        total  = bound(total, 2e6, 10_000e6);
        feeBps = uint16(bound(feeBps, FEE_MIN, FEE_MAX));
        uint256 fee = (total * feeBps + 9_999) / 10_000;
        usdc.mint(buyer, total + fee);
        vm.prank(buyer); usdc.approve(address(escrow), type(uint256).max);

        // Two milestones: M0=ATTESTATION (trigger), M1=ATTESTATION (cascade target)
        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](2);
        ms[0] = IWaybillEscrow.MilestoneInput({
            bps: 5000, condition: IWaybillEscrow.ReleaseCondition.ATTESTATION,
            attestors: _one(att0), threshold: 1,
            deadline: uint64(block.timestamp + 1 days),
            gracePeriod: 1, reviewWindow: 0, dependsOn: type(uint16).max
        });
        ms[1] = IWaybillEscrow.MilestoneInput({
            bps: 5000, condition: IWaybillEscrow.ReleaseCondition.ATTESTATION,
            attestors: _one(att0), threshold: 1,
            deadline: uint64(block.timestamp + 2 days),
            gracePeriod: 1, reviewWindow: 0, dependsOn: type(uint16).max
        });
        vm.prank(buyer);
        uint256 dealId = escrow.createDeal(
            supplier, buyerRefund, arbiter,
            total, feeBps,
            uint64(block.timestamp + 7 days), 48, ms
        );
        vm.prank(supplier); escrow.acceptSupplier(dealId, supplierPayout);
        vm.prank(att0);     escrow.acceptAttestor(dealId, 0);
        vm.prank(att0);     escrow.acceptAttestor(dealId, 1);
        vm.prank(arbiter);  escrow.acceptArbiter(dealId);
        vm.prank(buyer);    escrow.fund(dealId);

        // Warp past BOTH deadlines + grace
        vm.warp(block.timestamp + 3 days);
        escrow.applyDefault(dealId, 0); // M0 -> REFUNDABLE

        // Block buyerRefund — M0 refund + cascade M1 both fail
        usdc.setBlocked(buyerRefund, true);
        uint256 lockedBefore = escrow.currentLocked();

        // refund M0: M0 transfer fails, M0 stays REFUNDABLE; cascade never runs
        escrow.refund(dealId, 0);

        // M0 stays REFUNDABLE (blocked), M1 stays REFUNDABLE (not yet reached)
        assertEq(
            uint8(escrow.getMilestone(dealId, 0).state),
            uint8(IWaybillEscrow.MilestoneState.REFUNDABLE),
            "F5-cascade: M0 REFUNDABLE when buyer blocked"
        );
        assertEq(escrow.currentLocked(), lockedBefore,
            "F5-cascade: currentLocked unchanged when M0 blocked");

        // Unblock and retry M0 — this time M0 succeeds and cascade reaches M1
        usdc.setBlocked(buyerRefund, false);
        uint256 before = usdc.balanceOf(buyerRefund);
        escrow.refund(dealId, 0); // M0 refund + M1 cascade both succeed
        assertGt(usdc.balanceOf(buyerRefund), before,
            "F5-cascade: retry delivers M0 + cascade M1");
        assertEq(
            uint8(escrow.getMilestone(dealId, 0).state),
            uint8(IWaybillEscrow.MilestoneState.REFUNDED),
            "F5-cascade: M0 REFUNDED after retry"
        );
        assertEq(
            uint8(escrow.getMilestone(dealId, 1).state),
            uint8(IWaybillEscrow.MilestoneState.REFUNDED),
            "F5-cascade: M1 REFUNDED after cascade"
        );
        assertEq(escrow.currentLocked(), 0,
            "F5-cascade: locked zero after full cascade");
    }

    // =========================================================================
    // F6 — Vaults cannot reduce escrow balance or withdraw another actor's claim
    // =========================================================================

    function testFuzz_F6_BondVault_CannotReduceEscrowBalance(uint256 bondAmt) public {
        bondAmt = bound(bondAmt, 1e6, 10_000e6);
        usdc.mint(att0, bondAmt);
        vm.prank(att0); usdc.approve(address(bondVault), bondAmt);

        uint256 escrowBefore = usdc.balanceOf(address(escrow));

        // Deposit into BondVault (does NOT touch escrow)
        vm.prank(att0); bondVault.deposit(bondAmt);

        assertEq(usdc.balanceOf(address(escrow)), escrowBefore,
            "F6: bondVault deposit must not change escrow balance");

        // Withdraw from BondVault (does NOT touch escrow)
        vm.prank(att0); bondVault.withdraw(bondAmt);

        assertEq(usdc.balanceOf(address(escrow)), escrowBefore,
            "F6: bondVault withdraw must not change escrow balance");
    }

    function testFuzz_F6_FinancingVault_CannotReduceEscrowBalance(
        uint256 lenderAmt,
        uint256 borrowAmt
    ) public {
        lenderAmt = bound(lenderAmt, 1e6, 10_000e6);
        borrowAmt = bound(borrowAmt, 1, lenderAmt);

        address lender = address(0x1234);
        usdc.mint(lender, lenderAmt);
        vm.prank(lender); usdc.approve(address(finVault), lenderAmt);
        vm.prank(lender); finVault.deposit(lenderAmt);

        // Create a funded deal so supplier can borrow
        uint256 total   = 50_000e6;
        uint16  feeBps  = 75;
        uint256 fee     = (total * feeBps + 9_999) / 10_000;
        usdc.mint(buyer, total + fee);
        vm.prank(buyer); usdc.approve(address(escrow), type(uint256).max);

        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](1);
        ms[0] = IWaybillEscrow.MilestoneInput({
            bps: 10_000, condition: IWaybillEscrow.ReleaseCondition.ACCEPTANCE,
            attestors: _none(), threshold: 0,
            deadline: uint64(block.timestamp + 30 days),
            gracePeriod: 72, reviewWindow: 0, dependsOn: type(uint16).max
        });
        vm.prank(buyer);
        uint256 dealId = escrow.createDeal(
            supplier, buyerRefund, arbiter,
            total, feeBps,
            uint64(block.timestamp + 7 days), 48, ms
        );
        vm.prank(supplier); escrow.acceptSupplier(dealId, supplierPayout);
        vm.prank(arbiter);  escrow.acceptArbiter(dealId);
        vm.prank(buyer);    escrow.fund(dealId);

        uint256 escrowBefore = usdc.balanceOf(address(escrow));

        // Supplier borrows from financing vault (NOT from escrow)
        vm.prank(supplier); finVault.borrow(dealId, borrowAmt, 200);

        assertEq(usdc.balanceOf(address(escrow)), escrowBefore,
            "F6: finVault borrow must not change escrow balance");

        // Supplier repays
        usdc.mint(supplier, borrowAmt * 2);
        vm.prank(supplier); usdc.approve(address(finVault), borrowAmt * 2);
        vm.prank(supplier); finVault.repay(dealId, type(uint256).max);

        assertEq(usdc.balanceOf(address(escrow)), escrowBefore,
            "F6: finVault repay must not change escrow balance");
    }

    function testFuzz_F6_FinancingVault_ActorIsolation(uint256 amt) public {
        amt = bound(amt, 1e6, 10_000e6);

        address lender1 = address(0x1001);
        address lender2 = address(0x1002);

        usdc.mint(lender1, amt);
        usdc.mint(lender2, amt);
        vm.prank(lender1); usdc.approve(address(finVault), amt);
        vm.prank(lender2); usdc.approve(address(finVault), amt);
        vm.prank(lender1); finVault.deposit(amt);
        vm.prank(lender2); finVault.deposit(amt);

        // lender2 cannot withdraw more than their share
        uint256 l2balance = finVault.lenderBalance(lender2);
        vm.expectRevert();
        vm.prank(lender2); finVault.withdraw(l2balance + 1);

        // lender1 can withdraw exactly their principal
        uint256 l1principal = finVault.lenderPrincipal(lender1);
        uint256 l1before    = usdc.balanceOf(lender1);
        vm.prank(lender1);  finVault.withdraw(l1principal);
        assertEq(usdc.balanceOf(lender1) - l1before, l1principal,
            "F6: lender1 gets exactly their principal back");
        assertGe(finVault.lenderBalance(lender2), amt,
            "F6: lender2 balance unaffected by lender1 withdrawal");
    }

    // =========================================================================
    // F7 — Amount / bps boundary deterministic regressions
    // =========================================================================

    /// @notice Zero totalAmount must revert InvalidTotal.
    function testReg_ZeroTotalReverts() public {
        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](1);
        ms[0] = IWaybillEscrow.MilestoneInput({
            bps: 10_000, condition: IWaybillEscrow.ReleaseCondition.ACCEPTANCE,
            attestors: _none(), threshold: 0,
            deadline: uint64(block.timestamp + 30 days),
            gracePeriod: 72, reviewWindow: 0, dependsOn: type(uint16).max
        });
        vm.expectRevert(IWaybillEscrow.InvalidTotal.selector);
        vm.prank(buyer);
        escrow.createDeal(supplier, buyerRefund, arbiter,
            0, 75, uint64(block.timestamp + 7 days), 48, ms);
    }

    /// @notice feeBps below minFeeBps must revert InvalidFeeBps.
    function testReg_FeeBpsBelowMin_Reverts() public {
        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](1);
        ms[0] = IWaybillEscrow.MilestoneInput({
            bps: 10_000, condition: IWaybillEscrow.ReleaseCondition.ACCEPTANCE,
            attestors: _none(), threshold: 0,
            deadline: uint64(block.timestamp + 30 days),
            gracePeriod: 72, reviewWindow: 0, dependsOn: type(uint16).max
        });
        vm.expectRevert(IWaybillEscrow.InvalidFeeBps.selector);
        vm.prank(buyer);
        escrow.createDeal(supplier, buyerRefund, arbiter,
            1_000e6, 10, uint64(block.timestamp + 7 days), 48, ms);
    }

    /// @notice resolveSplit with supplierBps > 10_000 must revert InvalidSplitBps.
    function testReg_InvalidSplitBps_Reverts() public {
        (uint256 dealId,) = _singleMs(1_000e6, 75);

        // Dispute the milestone first
        vm.prank(pauser); escrow.pauseNewDeals(); // pause just to test resolve still works
        vm.prank(pauser); escrow.unpauseNewDeals();

        // We can't easily raise a dispute on an ACCEPTANCE milestone (needs IN_REVIEW).
        // Test the revert by checking the guard directly: create an ATTESTATION deal.
        uint256 total  = 1_000e6;
        uint16  feeBps = 75;
        uint256 fee    = (total * feeBps + 9_999) / 10_000;
        usdc.mint(buyer, total + fee);
        vm.prank(buyer); usdc.approve(address(escrow), type(uint256).max);

        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](1);
        ms[0] = IWaybillEscrow.MilestoneInput({
            bps: 10_000, condition: IWaybillEscrow.ReleaseCondition.ATTESTATION,
            attestors: _one(att0), threshold: 1,
            deadline: uint64(block.timestamp + 1 days),
            gracePeriod: 72, reviewWindow: 1, dependsOn: type(uint16).max
        });
        vm.prank(buyer);
        uint256 id2 = escrow.createDeal(
            supplier, buyerRefund, arbiter,
            total, feeBps,
            uint64(block.timestamp + 7 days), 48, ms
        );
        vm.prank(supplier); escrow.acceptSupplier(id2, supplierPayout);
        vm.prank(att0);     escrow.acceptAttestor(id2, 0);
        vm.prank(arbiter);  escrow.acceptArbiter(id2);
        vm.prank(buyer);    escrow.fund(id2);

        // Warp past deadline but within grace, raise supplier dispute
        vm.warp(block.timestamp + 1 days + 1 hours);
        vm.prank(supplier); escrow.dispute(id2, 0, bytes32("evidence"));
        // Respond and wait
        vm.prank(buyer); escrow.respondToDispute(id2, 0, bytes32("response"));
        vm.warp(block.timestamp + 72 hours + 1);

        vm.expectRevert(IWaybillEscrow.InvalidSplitBps.selector);
        vm.prank(arbiter); escrow.resolveSplit(id2, 0, 10_001);

        // suppress unused var
        dealId;
    }
}
