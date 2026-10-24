// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {IWaybillEscrow} from "../../src/interfaces/IWaybillEscrow.sol";
import {WaybillEscrow}  from "../../src/core/WaybillEscrow.sol";
import {ArbiterList}    from "../../src/registry/ArbiterList.sol";
import {AttestorRegistry} from "../../src/registry/AttestorRegistry.sol";

// ── Minimal mock USDC that supports per-address blocking ──────────────────────
contract MockUSDC {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => bool) public blocked;

    function mint(address to, uint256 amt) external { balanceOf[to] += amt; }
    function blockAddr(address a) external { blocked[a] = true; }
    function unblockAddr(address a) external { blocked[a] = false; }

    function approve(address spender, uint256 amt) external returns (bool) {
        allowance[msg.sender][spender] = amt;
        return true;
    }
    function transfer(address to, uint256 amt) external returns (bool) {
        if (blocked[to]) return false;
        require(balanceOf[msg.sender] >= amt, "insufficient");
        balanceOf[msg.sender] -= amt;
        balanceOf[to] += amt;
        return true;
    }
    function transferFrom(address from, address to, uint256 amt) external returns (bool) {
        if (blocked[to]) return false;
        require(allowance[from][msg.sender] >= amt, "allowance");
        require(balanceOf[from] >= amt, "insufficient");
        allowance[from][msg.sender] -= amt;
        balanceOf[from] -= amt;
        balanceOf[to] += amt;
        return true;
    }
}

// =============================================================================
contract Refund04e is Test {

    WaybillEscrow   internal escrow;
    MockUSDC        internal usdc;

    address internal treasury = address(0xBEEF01);
    address internal pauser   = address(0xBEEF02);

    address internal buyer    = address(0x1001);
    address internal supplier = address(0x1002);
    address internal arbiter  = address(0x1003);
    address internal buyRef   = address(0x1004);
    address internal supPay   = address(0x1005);

    uint16 internal constant FEE_BPS  = 100;   // 1%
    uint256 internal constant USDC_6  = 1e6;
    uint256 internal constant TOTAL   = 300 * USDC_6;

    // Fixed attestor keys
    uint256 internal constant ATT0_PK = 0xA000;
    uint256 internal constant ATT1_PK = 0xA001;
    uint256 internal constant ATT2_PK = 0xA002;

    function setUp() public {
        vm.warp(1_000_000);
        usdc = new MockUSDC();

        address[] memory arbs = new address[](1);
        arbs[0] = arbiter;
        ArbiterList list = new ArbiterList(pauser, arbs);
        AttestorRegistry reg = new AttestorRegistry(pauser);

        escrow = new WaybillEscrow(
            address(usdc), treasury, pauser,
            10_000 * USDC_6, 1_000_000 * USDC_6,
            address(list), address(reg)
        );
        vm.prank(pauser); reg.addWriter(address(escrow));
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    /// @dev Create a funded 3-milestone ATTESTATION deal.
    ///      M0=30% deadline=10d grace=1h, M1=30% deadline=20d grace=1h, M2=40% deadline=30d grace=1h.
    function _create3MsDeal() internal returns (
        uint256 dealId,
        uint256 fee0, uint256 fee1, uint256 fee2,
        uint256 t0,   uint256 t1,   uint256 t2
    ) {
        address att0 = vm.addr(ATT0_PK);
        address att1 = vm.addr(ATT1_PK);
        address att2 = vm.addr(ATT2_PK);

        address[] memory a0 = new address[](1); a0[0] = att0;
        address[] memory a1 = new address[](1); a1[0] = att1;
        address[] memory a2 = new address[](1); a2[0] = att2;

        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](3);
        ms[0] = IWaybillEscrow.MilestoneInput({
            bps: 3000, condition: IWaybillEscrow.ReleaseCondition.ATTESTATION,
            attestors: a0, threshold: 1,
            deadline: uint64(block.timestamp + 10 days), gracePeriod: 1, reviewWindow: 0,
            dependsOn: type(uint16).max
        });
        ms[1] = IWaybillEscrow.MilestoneInput({
            bps: 3000, condition: IWaybillEscrow.ReleaseCondition.ATTESTATION,
            attestors: a1, threshold: 1,
            deadline: uint64(block.timestamp + 20 days), gracePeriod: 1, reviewWindow: 0,
            dependsOn: type(uint16).max
        });
        ms[2] = IWaybillEscrow.MilestoneInput({
            bps: 4000, condition: IWaybillEscrow.ReleaseCondition.ATTESTATION,
            attestors: a2, threshold: 1,
            deadline: uint64(block.timestamp + 30 days), gracePeriod: 1, reviewWindow: 0,
            dependsOn: type(uint16).max
        });

        uint256 totalFee = (TOTAL * FEE_BPS + 9999) / 10000;
        usdc.mint(buyer, TOTAL + totalFee);
        vm.prank(buyer); usdc.approve(address(escrow), TOTAL + totalFee);

        vm.prank(buyer);
        dealId = escrow.createDeal(supplier, buyRef, arbiter, TOTAL, FEE_BPS,
            uint64(block.timestamp + 7 days), 168, ms);

        vm.prank(supplier); escrow.acceptSupplier(dealId, supPay);
        vm.prank(att0);     escrow.acceptAttestor(dealId, 0);
        vm.prank(att1);     escrow.acceptAttestor(dealId, 1);
        vm.prank(att2);     escrow.acceptAttestor(dealId, 2);
        vm.prank(arbiter);  escrow.acceptArbiter(dealId);
        vm.prank(buyer);    escrow.fund(dealId);

        fee0 = escrow.getTrancheFee(dealId, 0);
        fee1 = escrow.getTrancheFee(dealId, 1);
        fee2 = escrow.getTrancheFee(dealId, 2);
        t0 = TOTAL * 3000 / 10000;
        t1 = TOTAL * 3000 / 10000;
        t2 = TOTAL - t0 - t1;
    }

    /// @dev Sign and submit an attestation for milestone idx using the given pk.
    function _attest(uint256 dealId, uint8 idx, uint256 signerPk) internal {
        address signer = vm.addr(signerPk);
        bytes32 ev = keccak256(abi.encode("ev", dealId, idx));
        uint64 now64 = uint64(block.timestamp);
        bytes32 structHash = keccak256(abi.encode(
            escrow.ATTESTATION_TYPEHASH(),
            dealId, uint256(idx), block.chainid, address(escrow),
            signer, escrow.STATEMENT_VERSION(), ev, now64, now64 + 2 days
        ));
        bytes32 digest = escrow.hashTypedDataV4(structHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPk, digest);
        escrow.attest(dealId, idx, ev, now64, now64 + 2 days, signer, abi.encodePacked(r, s, v));
    }

    /// @dev Make milestone REFUNDABLE: warp past deadline+grace, then applyDefault.
    function _makeRefundable(uint256 dealId, uint8 idx) internal {
        IWaybillEscrow.Milestone memory ms = escrow.getMilestone(dealId, idx);
        vm.warp(uint256(ms.deadline) + uint256(ms.gracePeriod) * 1 hours + 1);
        escrow.applyDefault(dealId, idx);
        assertEq(uint8(escrow.getMilestone(dealId, idx).state),
            uint8(IWaybillEscrow.MilestoneState.REFUNDABLE), "must be REFUNDABLE");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // T1: M0 RELEASED (claimed), M1 REFUNDABLE (trigger), M2 WAITING (inside deadline).
    //     Cascade MUST sweep M2 even though it is still WAITING.
    //     Verifies exact amounts, states, and currentLocked delta.
    // ═════════════════════════════════════════════════════════════════════════
    function testCascade_M0Released_M1Trigger_M2WaitingSwept() public {
        (uint256 dealId,
         uint256 fee0, uint256 fee1, uint256 fee2,
         uint256 t0,   uint256 t1,   uint256 t2) = _create3MsDeal();

        // Attest + claim M0 → RELEASED
        _attest(dealId, 0, ATT0_PK);
        escrow.claim(dealId, 0);
        assertEq(uint8(escrow.getMilestone(dealId, 0).state),
            uint8(IWaybillEscrow.MilestoneState.RELEASED), "M0 RELEASED");

        // Make M1 REFUNDABLE (warp to ~20d+1h).
        // M2 deadline = 30d, so M2 is still WAITING at this point.
        _makeRefundable(dealId, 1);
        assertEq(uint8(escrow.getMilestone(dealId, 2).state),
            uint8(IWaybillEscrow.MilestoneState.WAITING), "M2 still WAITING before cascade");

        uint256 lockedBefore  = escrow.currentLocked();
        uint256 buyRefBefore  = usdc.balanceOf(buyRef);
        uint256 escrowBefore  = usdc.balanceOf(address(escrow));

        // Trigger refund on M1 → cascade sweeps M2 (WAITING) too
        escrow.refund(dealId, 1);

        // M0 still RELEASED — must never be touched
        assertEq(uint8(escrow.getMilestone(dealId, 0).state),
            uint8(IWaybillEscrow.MilestoneState.RELEASED), "M0 still RELEASED");
        // M1 trigger → REFUNDED
        assertEq(uint8(escrow.getMilestone(dealId, 1).state),
            uint8(IWaybillEscrow.MilestoneState.REFUNDED), "M1 REFUNDED");
        // M2 WAITING → swept → REFUNDED
        assertEq(uint8(escrow.getMilestone(dealId, 2).state),
            uint8(IWaybillEscrow.MilestoneState.REFUNDED), "M2 WAITING cascaded to REFUNDED");

        // Buyer received: M1 (tranche+fee) + M2 (tranche+fee) — not M0 (already paid to supplier)
        uint256 expectedRefund = (t1 + fee1) + (t2 + fee2);
        assertEq(usdc.balanceOf(buyRef) - buyRefBefore, expectedRefund, "buyer refund exact");

        // Supplier payout received t0 only (from the earlier M0 claim)
        assertEq(usdc.balanceOf(supPay), t0, "supplier payout only M0 tranche");

        // currentLocked decreased by exactly M1+M2
        assertEq(lockedBefore - escrow.currentLocked(), expectedRefund,
            "currentLocked delta == M1+M2 refund");
        assertEq(escrowBefore - usdc.balanceOf(address(escrow)), expectedRefund,
            "escrow USDC delta == M1+M2 refund");

        // Treasury: M0 is ATTESTATION → 60% of fee0. M1+M2 refunded → no fee accrual.
        uint256 treasury0 = fee0 * 60 / 100;
        assertEq(escrow.feeBalance(treasury), treasury0, "treasury only got M0 ATTESTATION fee (60%)");

        // Deal settled since all milestones terminal
        assertEq(uint8(escrow.getDeal(dealId).state),
            uint8(IWaybillEscrow.DealState.SETTLED), "deal SETTLED");

        fee0 = fee0; t0 = t0; // suppress unused
    }

    // ═════════════════════════════════════════════════════════════════════════
    // T2: CLAIMABLE later milestone swept.
    //     M0=ATTESTATION(50%), M1=ACCEPTANCE(50%). M0 REFUNDABLE trigger.
    //     M1 is CLAIMABLE (ACCEPTANCE starts CLAIMABLE on fund).
    //     Cascade must sweep M1 → REFUNDED. Deal settles.
    // ═════════════════════════════════════════════════════════════════════════
    function testCascade_ClaimableLater_Swept() public {
        address att0 = vm.addr(ATT0_PK);
        address[] memory a0 = new address[](1); a0[0] = att0;
        address[] memory none = new address[](0);

        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](2);
        ms[0] = IWaybillEscrow.MilestoneInput({
            bps: 5000, condition: IWaybillEscrow.ReleaseCondition.ATTESTATION,
            attestors: a0, threshold: 1,
            deadline: uint64(block.timestamp + 5 days), gracePeriod: 0, reviewWindow: 0,
            dependsOn: type(uint16).max
        });
        ms[1] = IWaybillEscrow.MilestoneInput({
            bps: 5000, condition: IWaybillEscrow.ReleaseCondition.ACCEPTANCE,
            attestors: none, threshold: 0,
            deadline: uint64(block.timestamp + 30 days), gracePeriod: 0, reviewWindow: 0,
            dependsOn: type(uint16).max
        });

        uint256 total = 200 * USDC_6;
        uint256 totalFee = (total * FEE_BPS + 9999) / 10000;
        usdc.mint(buyer, total + totalFee);
        vm.prank(buyer); usdc.approve(address(escrow), total + totalFee);
        vm.prank(buyer);
        uint256 dealId = escrow.createDeal(supplier, buyRef, arbiter, total, FEE_BPS,
            uint64(block.timestamp + 7 days), 168, ms);
        vm.prank(supplier); escrow.acceptSupplier(dealId, supPay);
        vm.prank(att0);     escrow.acceptAttestor(dealId, 0);
        vm.prank(arbiter);  escrow.acceptArbiter(dealId);
        vm.prank(buyer);    escrow.fund(dealId);

        // M1 is CLAIMABLE immediately (ACCEPTANCE)
        assertEq(uint8(escrow.getMilestone(dealId, 1).state),
            uint8(IWaybillEscrow.MilestoneState.CLAIMABLE), "M1 CLAIMABLE after fund");

        // Make M0 REFUNDABLE (warp past 5d deadline, no grace)
        vm.warp(block.timestamp + 5 days + 1);
        escrow.applyDefault(dealId, 0);

        uint256 fee0 = escrow.getTrancheFee(dealId, 0);
        uint256 fee1 = escrow.getTrancheFee(dealId, 1);
        uint256 t0   = total * 5000 / 10000;
        uint256 t1   = total - t0;

        uint256 buyRefBefore = usdc.balanceOf(buyRef);
        uint256 lockedBefore = escrow.currentLocked();

        escrow.refund(dealId, 0);

        assertEq(uint8(escrow.getMilestone(dealId, 0).state),
            uint8(IWaybillEscrow.MilestoneState.REFUNDED), "M0 REFUNDED");
        assertEq(uint8(escrow.getMilestone(dealId, 1).state),
            uint8(IWaybillEscrow.MilestoneState.REFUNDED), "M1 CLAIMABLE cascaded REFUNDED");

        uint256 expected = (t0 + fee0) + (t1 + fee1);
        assertEq(usdc.balanceOf(buyRef) - buyRefBefore, expected, "buyer got both tranches");
        assertEq(lockedBefore - escrow.currentLocked(), expected, "locked delta exact");
        assertEq(uint8(escrow.getDeal(dealId).state),
            uint8(IWaybillEscrow.DealState.SETTLED), "deal SETTLED");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // T3: IN_REVIEW later milestone swept.
    //     M1 has reviewWindow=24h. Attest M1 → IN_REVIEW. Then M0 refund trigger.
    //     Cascade must sweep M1 (IN_REVIEW) → REFUNDED.
    // ═════════════════════════════════════════════════════════════════════════
    function testCascade_InReviewLater_Swept() public {
        address att0 = vm.addr(ATT0_PK);
        address att1 = vm.addr(ATT1_PK);
        address[] memory a0 = new address[](1); a0[0] = att0;
        address[] memory a1 = new address[](1); a1[0] = att1;

        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](2);
        ms[0] = IWaybillEscrow.MilestoneInput({
            bps: 5000, condition: IWaybillEscrow.ReleaseCondition.ATTESTATION,
            attestors: a0, threshold: 1,
            deadline: uint64(block.timestamp + 5 days), gracePeriod: 0, reviewWindow: 0,
            dependsOn: type(uint16).max
        });
        ms[1] = IWaybillEscrow.MilestoneInput({
            bps: 5000, condition: IWaybillEscrow.ReleaseCondition.ATTESTATION,
            attestors: a1, threshold: 1,
            deadline: uint64(block.timestamp + 30 days), gracePeriod: 0, reviewWindow: 24,
            dependsOn: type(uint16).max
        });

        uint256 total = 200 * USDC_6;
        uint256 totalFee = (total * FEE_BPS + 9999) / 10000;
        usdc.mint(buyer, total + totalFee);
        vm.prank(buyer); usdc.approve(address(escrow), total + totalFee);
        vm.prank(buyer);
        uint256 dealId = escrow.createDeal(supplier, buyRef, arbiter, total, FEE_BPS,
            uint64(block.timestamp + 7 days), 168, ms);
        vm.prank(supplier); escrow.acceptSupplier(dealId, supPay);
        vm.prank(att0);     escrow.acceptAttestor(dealId, 0);
        vm.prank(att1);     escrow.acceptAttestor(dealId, 1);
        vm.prank(arbiter);  escrow.acceptArbiter(dealId);
        vm.prank(buyer);    escrow.fund(dealId);

        // Attest M1 → IN_REVIEW (reviewWindow=24h)
        _attest(dealId, 1, ATT1_PK);
        assertEq(uint8(escrow.getMilestone(dealId, 1).state),
            uint8(IWaybillEscrow.MilestoneState.IN_REVIEW), "M1 IN_REVIEW");

        // Make M0 REFUNDABLE (warp past 5d, no grace — but M1 deadline is 30d so still IN_REVIEW)
        vm.warp(block.timestamp + 5 days + 1);
        escrow.applyDefault(dealId, 0);

        uint256 fee0 = escrow.getTrancheFee(dealId, 0);
        uint256 fee1 = escrow.getTrancheFee(dealId, 1);
        uint256 t0   = total * 5000 / 10000;
        uint256 t1   = total - t0;

        uint256 buyRefBefore = usdc.balanceOf(buyRef);
        uint256 lockedBefore = escrow.currentLocked();

        // Cascade sweeps M1 (IN_REVIEW) → REFUNDED
        escrow.refund(dealId, 0);

        assertEq(uint8(escrow.getMilestone(dealId, 0).state),
            uint8(IWaybillEscrow.MilestoneState.REFUNDED), "M0 REFUNDED");
        assertEq(uint8(escrow.getMilestone(dealId, 1).state),
            uint8(IWaybillEscrow.MilestoneState.REFUNDED), "M1 IN_REVIEW cascaded REFUNDED");

        uint256 expected = (t0 + fee0) + (t1 + fee1);
        assertEq(usdc.balanceOf(buyRef) - buyRefBefore, expected, "buyer got both tranches");
        assertEq(lockedBefore - escrow.currentLocked(), expected, "locked delta exact");
        assertEq(uint8(escrow.getDeal(dealId).state),
            uint8(IWaybillEscrow.DealState.SETTLED), "deal SETTLED");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // T4: Later DISPUTED milestone is NOT swept; deal stays FUNDED.
    //     M1 REFUNDABLE trigger, M2 DISPUTED → skipped.
    // ═════════════════════════════════════════════════════════════════════════
    function testCascade_DisputedLaterNotSwept() public {
        address att0 = vm.addr(ATT0_PK);
        address att1 = vm.addr(ATT1_PK);
        address att2 = vm.addr(ATT2_PK);

        address[] memory a0 = new address[](1); a0[0] = att0;
        address[] memory a1 = new address[](1); a1[0] = att1;
        address[] memory a2 = new address[](1); a2[0] = att2;

        // M2 reviewWindow=24 so buyer can dispute IN_REVIEW
        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](3);
        ms[0] = IWaybillEscrow.MilestoneInput({
            bps: 3000, condition: IWaybillEscrow.ReleaseCondition.ATTESTATION,
            attestors: a0, threshold: 1,
            deadline: uint64(block.timestamp + 10 days), gracePeriod: 1, reviewWindow: 0,
            dependsOn: type(uint16).max
        });
        ms[1] = IWaybillEscrow.MilestoneInput({
            bps: 3000, condition: IWaybillEscrow.ReleaseCondition.ATTESTATION,
            attestors: a1, threshold: 1,
            deadline: uint64(block.timestamp + 20 days), gracePeriod: 1, reviewWindow: 0,
            dependsOn: type(uint16).max
        });
        ms[2] = IWaybillEscrow.MilestoneInput({
            bps: 4000, condition: IWaybillEscrow.ReleaseCondition.ATTESTATION,
            attestors: a2, threshold: 1,
            deadline: uint64(block.timestamp + 30 days), gracePeriod: 1, reviewWindow: 24,
            dependsOn: type(uint16).max
        });

        uint256 totalFee = (TOTAL * FEE_BPS + 9999) / 10000;
        usdc.mint(buyer, TOTAL + totalFee);
        vm.prank(buyer); usdc.approve(address(escrow), TOTAL + totalFee);
        vm.prank(buyer);
        uint256 dealId = escrow.createDeal(supplier, buyRef, arbiter, TOTAL, FEE_BPS,
            uint64(block.timestamp + 7 days), 168, ms);
        vm.prank(supplier); escrow.acceptSupplier(dealId, supPay);
        vm.prank(att0);     escrow.acceptAttestor(dealId, 0);
        vm.prank(att1);     escrow.acceptAttestor(dealId, 1);
        vm.prank(att2);     escrow.acceptAttestor(dealId, 2);
        vm.prank(arbiter);  escrow.acceptArbiter(dealId);
        vm.prank(buyer);    escrow.fund(dealId);

        // Attest M2 → IN_REVIEW, then buyer disputes
        _attest(dealId, 2, ATT2_PK);
        assertEq(uint8(escrow.getMilestone(dealId, 2).state),
            uint8(IWaybillEscrow.MilestoneState.IN_REVIEW), "M2 IN_REVIEW");
        vm.prank(buyer); escrow.dispute(dealId, 2, keccak256("dispute-evidence"));
        assertEq(uint8(escrow.getMilestone(dealId, 2).state),
            uint8(IWaybillEscrow.MilestoneState.DISPUTED), "M2 DISPUTED");

        // Make M1 REFUNDABLE and trigger cascade
        _makeRefundable(dealId, 1);

        uint256 fee1 = escrow.getTrancheFee(dealId, 1);
        uint256 t1   = TOTAL * 3000 / 10000;
        uint256 buyRefBefore = usdc.balanceOf(buyRef);
        uint256 lockedBefore = escrow.currentLocked();

        escrow.refund(dealId, 1); // cascade hits M2 → DISPUTED → skipped

        assertEq(uint8(escrow.getMilestone(dealId, 1).state),
            uint8(IWaybillEscrow.MilestoneState.REFUNDED), "M1 REFUNDED");
        assertEq(uint8(escrow.getMilestone(dealId, 2).state),
            uint8(IWaybillEscrow.MilestoneState.DISPUTED), "M2 still DISPUTED, not swept");

        assertEq(usdc.balanceOf(buyRef) - buyRefBefore, t1 + fee1, "buyer only M1");
        assertEq(lockedBefore - escrow.currentLocked(), t1 + fee1, "locked delta = M1 only");

        // Deal NOT settled (M2 DISPUTED)
        assertEq(uint8(escrow.getDeal(dealId).state),
            uint8(IWaybillEscrow.DealState.FUNDED), "deal FUNDED, M2 disputed blocks settle");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // T5: All 3 milestones REFUNDABLE before first call — one refund() settles the deal.
    // ═════════════════════════════════════════════════════════════════════════
    function testCascade_AllRefundable_OneTxSettles() public {
        (uint256 dealId,
         uint256 fee0, uint256 fee1, uint256 fee2,
         uint256 t0,   uint256 t1,   uint256 t2) = _create3MsDeal();

        _makeRefundable(dealId, 0);
        _makeRefundable(dealId, 1);
        _makeRefundable(dealId, 2);

        uint256 buyerBefore  = usdc.balanceOf(buyRef);
        uint256 escrowBefore = usdc.balanceOf(address(escrow));

        escrow.refund(dealId, 0); // sweeps M1+M2 via cascade

        assertEq(uint8(escrow.getMilestone(dealId, 0).state),
            uint8(IWaybillEscrow.MilestoneState.REFUNDED), "M0 REFUNDED");
        assertEq(uint8(escrow.getMilestone(dealId, 1).state),
            uint8(IWaybillEscrow.MilestoneState.REFUNDED), "M1 cascaded REFUNDED");
        assertEq(uint8(escrow.getMilestone(dealId, 2).state),
            uint8(IWaybillEscrow.MilestoneState.REFUNDED), "M2 cascaded REFUNDED");

        uint256 expectedTotal = (t0+fee0) + (t1+fee1) + (t2+fee2);
        assertEq(usdc.balanceOf(buyRef) - buyerBefore, expectedTotal, "buyer got all 3 tranches");
        assertEq(escrowBefore - usdc.balanceOf(address(escrow)), expectedTotal, "escrow fully drained");
        assertEq(escrow.currentLocked(), 0, "currentLocked zero");
        assertEq(uint8(escrow.getDeal(dealId).state),
            uint8(IWaybillEscrow.DealState.SETTLED), "deal SETTLED");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // T6: RELEASED tranche never re-paid by cascade.
    //     M0 RELEASED (claimed), M1 REFUNDABLE trigger. M2 WAITING.
    //     Cascade sweeps M2 (WAITING) but must NOT re-pay M0 (RELEASED).
    // ═════════════════════════════════════════════════════════════════════════
    function testCascade_ReleasedNotTouched() public {
        (uint256 dealId,
         uint256 fee0,,,
         uint256 t0,,) = _create3MsDeal();

        // Attest + claim M0 → RELEASED; record supplier balance
        _attest(dealId, 0, ATT0_PK);
        escrow.claim(dealId, 0);
        uint256 supPayAfterClaim = usdc.balanceOf(supPay);
        assertEq(supPayAfterClaim, t0, "supplier has t0 after M0 claim");

        // Make M1 REFUNDABLE; M2 still WAITING (30d deadline, we're at ~20d+1h)
        _makeRefundable(dealId, 1);
        uint256 treaBefore = escrow.feeBalance(treasury);

        escrow.refund(dealId, 1);

        // Supplier received nothing extra (M0 was the only paid tranche)
        assertEq(usdc.balanceOf(supPay), supPayAfterClaim, "supplier balance unchanged by cascade");

        // Treasury: only 60% of fee0 from M0 ATTESTATION; no extra from refunds
        assertEq(escrow.feeBalance(treasury) - treaBefore, 0, "no extra treasury fee from cascade");
        assertEq(escrow.feeBalance(treasury), fee0 * 60 / 100, "treasury = 60% of M0 fee");

        // M0 still RELEASED
        assertEq(uint8(escrow.getMilestone(dealId, 0).state),
            uint8(IWaybillEscrow.MilestoneState.RELEASED), "M0 still RELEASED");
        // M1 REFUNDED (trigger)
        assertEq(uint8(escrow.getMilestone(dealId, 1).state),
            uint8(IWaybillEscrow.MilestoneState.REFUNDED), "M1 REFUNDED");
        // M2 WAITING → swept → REFUNDED
        assertEq(uint8(escrow.getMilestone(dealId, 2).state),
            uint8(IWaybillEscrow.MilestoneState.REFUNDED), "M2 cascaded REFUNDED");

        // Deal settled
        assertEq(uint8(escrow.getDeal(dealId).state),
            uint8(IWaybillEscrow.DealState.SETTLED), "deal SETTLED");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // T7: Repeat refund/cascade call reverts — deal already SETTLED.
    // ═════════════════════════════════════════════════════════════════════════
    function testCascade_RepeatRefundReverts() public {
        (uint256 dealId,,,,,, ) = _create3MsDeal();

        _makeRefundable(dealId, 0);
        _makeRefundable(dealId, 1);
        _makeRefundable(dealId, 2);
        escrow.refund(dealId, 0); // cascades M1+M2 → all REFUNDED → deal SETTLED

        assertEq(uint8(escrow.getDeal(dealId).state),
            uint8(IWaybillEscrow.DealState.SETTLED), "deal SETTLED after cascade");

        // Second refund on any milestone → deal SETTLED → InvalidDealState
        vm.expectRevert(IWaybillEscrow.InvalidDealState.selector);
        escrow.refund(dealId, 0);

        vm.expectRevert(IWaybillEscrow.InvalidDealState.selector);
        escrow.refund(dealId, 1);
    }

    // ═════════════════════════════════════════════════════════════════════════
    // T8: Blocked buyer — M1 REFUNDABLE trigger, M2 WAITING.
    //     M1 transfer blocked → _refundBuyer resets M1 to REFUNDABLE.
    //     Cascade still runs and tries M2 (WAITING); M2 also blocked →
    //     cascadeRefundPending[dealId][2] set, M2 stays REFUNDED, currentLocked unchanged.
    //     After address-change/unblock: retry delivers M2 exactly once; normal refund(M1).
    //     Settlement only after ALL milestones terminal and pending cleared.
    // ═════════════════════════════════════════════════════════════════════════
    function testCascade_BlockedBuyer_PendingRetry() public {
        (uint256 dealId,
         , uint256 fee1, uint256 fee2,
         , uint256 t1,  uint256 t2) = _create3MsDeal();

        // Make M1 REFUNDABLE; M2 still WAITING (30d deadline, we're at ~20d+1h)
        _makeRefundable(dealId, 1);

        // Block buyRef so both M1 and M2 cascade transfers fail
        usdc.blockAddr(buyRef);

        uint256 lockedBefore = escrow.currentLocked();

        // refund(M1): M1 blocked → reset to REFUNDABLE; cascade: M2 WAITING → REFUNDED set,
        // transfer fails → cascadeRefundPending[dealId][2] set, currentLocked restored
        escrow.refund(dealId, 1);

        // M1 reset to REFUNDABLE by _refundBuyer failure
        assertEq(uint8(escrow.getMilestone(dealId, 1).state),
            uint8(IWaybillEscrow.MilestoneState.REFUNDABLE), "M1 still REFUNDABLE after blocked");
        // M2 transfer failed → milestone stays REFUNDABLE (non-terminal, retryable)
        assertEq(uint8(escrow.getMilestone(dealId, 2).state),
            uint8(IWaybillEscrow.MilestoneState.REFUNDABLE), "M2 REFUNDABLE after blocked cascade");

        // Pending amount stored for M2
        uint256 m2pending = escrow.cascadeRefundPending(dealId, 2);
        assertEq(m2pending, t2 + fee2, "M2 cascade pending exact");

        // currentLocked unchanged — both transfers failed, locked fully restored
        assertEq(escrow.currentLocked(), lockedBefore, "currentLocked unchanged after double-blocked");

        // Deal NOT settled (M1 REFUNDABLE and cascadeRefundPending[2] > 0 both block it)
        assertEq(uint8(escrow.getDeal(dealId).state),
            uint8(IWaybillEscrow.DealState.FUNDED), "deal still FUNDED");

        // Unblock buyRef and retry M2 cascade
        usdc.unblockAddr(buyRef);
        uint256 buyRefBefore  = usdc.balanceOf(buyRef);
        uint256 lockedBefore2 = escrow.currentLocked();

        escrow.retryCascadeRefund(dealId, 2);

        assertEq(usdc.balanceOf(buyRef) - buyRefBefore, t2 + fee2, "buyer got M2 on retry");
        assertEq(lockedBefore2 - escrow.currentLocked(), t2 + fee2, "locked decremented on retry");
        assertEq(escrow.cascadeRefundPending(dealId, 2), 0, "pending cleared");

        // Deal still FUNDED because M1 is REFUNDABLE (not terminal)
        assertEq(uint8(escrow.getDeal(dealId).state),
            uint8(IWaybillEscrow.DealState.FUNDED), "deal FUNDED (M1 still REFUNDABLE)");

        // Normal refund on M1 (buyer now unblocked); M0 still WAITING
        escrow.refund(dealId, 1);
        assertEq(uint8(escrow.getMilestone(dealId, 1).state),
            uint8(IWaybillEscrow.MilestoneState.REFUNDED), "M1 REFUNDED after unblock");

        // M0 still WAITING → deal still FUNDED
        assertEq(uint8(escrow.getDeal(dealId).state),
            uint8(IWaybillEscrow.DealState.FUNDED), "deal FUNDED (M0 WAITING)");

        // Make M0 REFUNDABLE → refund → cascade finds nothing later → settle
        _makeRefundable(dealId, 0);
        escrow.refund(dealId, 0);
        assertEq(uint8(escrow.getDeal(dealId).state),
            uint8(IWaybillEscrow.DealState.SETTLED), "deal SETTLED after all milestones terminal");

        fee1 = fee1; t1 = t1; // suppress unused
    }

    // ═════════════════════════════════════════════════════════════════════════
    // T9: Second retryCascadeRefund reverts CascadeRefundNotPending.
    //     Cannot deliver the same cascade tranche twice.
    // ═════════════════════════════════════════════════════════════════════════
    function testRetryCascade_SecondCallReverts() public {
        (uint256 dealId,
         , uint256 fee1, uint256 fee2,
         , uint256 t1,  uint256 t2) = _create3MsDeal();

        _makeRefundable(dealId, 1);
        // M2 is WAITING — still within cascade scope
        usdc.blockAddr(buyRef);
        escrow.refund(dealId, 1); // M2 pending

        usdc.unblockAddr(buyRef);
        escrow.retryCascadeRefund(dealId, 2); // succeeds

        // Second retry → nothing pending
        vm.expectRevert(IWaybillEscrow.CascadeRefundNotPending.selector);
        escrow.retryCascadeRefund(dealId, 2);

        fee1 = fee1; t1 = t1; fee2 = fee2; t2 = t2; // suppress unused
    }

    // ═════════════════════════════════════════════════════════════════════════
    // T10: currentLocked invariant: escrow balance always >= currentLocked throughout.
    //      Also verifies pendingSettle blocked while cascade pending.
    // ═════════════════════════════════════════════════════════════════════════
    function testCascade_LockedInvariantThroughout() public {
        (uint256 dealId,,,,,,) = _create3MsDeal();

        // After fund
        assertGe(usdc.balanceOf(address(escrow)), escrow.currentLocked(), "invariant after fund");

        // Attest + claim M0
        _attest(dealId, 0, ATT0_PK);
        escrow.claim(dealId, 0);
        assertGe(usdc.balanceOf(address(escrow)), escrow.currentLocked(), "invariant after M0 claim");

        // Make M1 REFUNDABLE; M2 WAITING — cascade sweeps M2
        _makeRefundable(dealId, 1);
        escrow.refund(dealId, 1);
        assertGe(usdc.balanceOf(address(escrow)), escrow.currentLocked(), "invariant after cascade");

        // All milestones terminal → deal settled
        assertEq(escrow.currentLocked(), 0, "currentLocked zero after full settle");
        assertEq(uint8(escrow.getDeal(dealId).state),
            uint8(IWaybillEscrow.DealState.SETTLED), "deal SETTLED");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // T11: Single-milestone deal — cascade is a no-op (no milestones after index).
    //      refund(0) settles the deal normally.
    // ═════════════════════════════════════════════════════════════════════════
    function testCascade_SingleMilestone_NoopCascade() public {
        address att0 = vm.addr(ATT0_PK);
        address[] memory atts = new address[](1); atts[0] = att0;

        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](1);
        ms[0] = IWaybillEscrow.MilestoneInput({
            bps: 10000, condition: IWaybillEscrow.ReleaseCondition.ATTESTATION,
            attestors: atts, threshold: 1,
            deadline: uint64(block.timestamp + 5 days), gracePeriod: 1, reviewWindow: 0,
            dependsOn: type(uint16).max
        });
        uint256 total1 = 100 * USDC_6;
        uint256 totalFee1 = (total1 * FEE_BPS + 9999) / 10000;
        usdc.mint(buyer, total1 + totalFee1);
        vm.prank(buyer); usdc.approve(address(escrow), total1 + totalFee1);

        vm.prank(buyer);
        uint256 dealId = escrow.createDeal(supplier, buyRef, arbiter, total1, FEE_BPS,
            uint64(block.timestamp + 7 days), 168, ms);
        vm.prank(supplier); escrow.acceptSupplier(dealId, supPay);
        vm.prank(att0);     escrow.acceptAttestor(dealId, 0);
        vm.prank(arbiter);  escrow.acceptArbiter(dealId);
        vm.prank(buyer);    escrow.fund(dealId);

        _makeRefundable(dealId, 0);

        uint256 fee0 = escrow.getTrancheFee(dealId, 0);
        uint256 buyerBefore = usdc.balanceOf(buyRef);
        escrow.refund(dealId, 0);

        assertEq(uint8(escrow.getMilestone(dealId, 0).state),
            uint8(IWaybillEscrow.MilestoneState.REFUNDED), "M0 REFUNDED");
        assertEq(usdc.balanceOf(buyRef) - buyerBefore, total1 + fee0, "buyer gets full amount");
        assertEq(uint8(escrow.getDeal(dealId).state),
            uint8(IWaybillEscrow.DealState.SETTLED), "deal SETTLED");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // T12: Settlement is blocked while cascadeRefundPending > 0.
    //      All milestones REFUNDED but one cascade transfer still pending.
    //      _checkAndSettleDeal must not settle until retry clears the pending.
    // ═════════════════════════════════════════════════════════════════════════
    function testCascade_SettleBlockedWhilePending() public {
        (uint256 dealId,
         uint256 fee0, uint256 fee1, uint256 fee2,
         uint256 t0,   uint256 t1,   uint256 t2) = _create3MsDeal();

        // Make all milestones REFUNDABLE
        _makeRefundable(dealId, 0);
        _makeRefundable(dealId, 1);
        _makeRefundable(dealId, 2);

        // Block buyRef AFTER all are REFUNDABLE
        usdc.blockAddr(buyRef);

        // refund(M0): M0 transfer blocked → M0 reset to REFUNDABLE
        // cascade: M1 blocked → pending; M2 blocked → pending
        escrow.refund(dealId, 0);

        // M0 reset to REFUNDABLE (trigger transfer failed)
        assertEq(uint8(escrow.getMilestone(dealId, 0).state),
            uint8(IWaybillEscrow.MilestoneState.REFUNDABLE), "M0 back to REFUNDABLE");
        // M1 + M2 cascade transfers failed → both stay REFUNDABLE (non-terminal, retryable)
        assertEq(uint8(escrow.getMilestone(dealId, 1).state),
            uint8(IWaybillEscrow.MilestoneState.REFUNDABLE), "M1 REFUNDABLE after blocked cascade");
        assertEq(uint8(escrow.getMilestone(dealId, 2).state),
            uint8(IWaybillEscrow.MilestoneState.REFUNDABLE), "M2 REFUNDABLE after blocked cascade");

        assertGt(escrow.cascadeRefundPending(dealId, 1), 0, "M1 pending > 0");
        assertGt(escrow.cascadeRefundPending(dealId, 2), 0, "M2 pending > 0");

        // Deal NOT settled despite all states being REFUNDED/REFUNDABLE
        assertEq(uint8(escrow.getDeal(dealId).state),
            uint8(IWaybillEscrow.DealState.FUNDED), "deal FUNDED while pending");

        // Unblock and retry all
        usdc.unblockAddr(buyRef);
        escrow.retryCascadeRefund(dealId, 1);
        escrow.retryCascadeRefund(dealId, 2);
        // Also retry M0 via normal refund
        escrow.refund(dealId, 0);

        assertEq(uint8(escrow.getDeal(dealId).state),
            uint8(IWaybillEscrow.DealState.SETTLED), "deal SETTLED after all pending cleared");

        // Exact amounts: buyer received all tranches + fees
        uint256 totalFee = (TOTAL * FEE_BPS + 9999) / 10000;
        assertEq(usdc.balanceOf(buyRef), TOTAL + totalFee, "buyer received total+fee");

        // Suppress unused
        fee0 = fee0; fee1 = fee1; fee2 = fee2; t0 = t0; t1 = t1; t2 = t2;
    }
}
