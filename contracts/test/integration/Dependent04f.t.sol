// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {IWaybillEscrow} from "../../src/interfaces/IWaybillEscrow.sol";
import {WaybillEscrow}  from "../../src/core/WaybillEscrow.sol";
import {ArbiterList}    from "../../src/registry/ArbiterList.sol";
import {AttestorRegistry} from "../../src/registry/AttestorRegistry.sol";

// ── Minimal mock USDC ────────────────────────────────────────────────────────
contract MockUSDC {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => bool) public blocked;

    function mint(address to, uint256 amt) external { balanceOf[to] += amt; }
    function blockAddr(address a)   external { blocked[a] = true; }
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
contract Dependent04f is Test {

    WaybillEscrow  internal escrow;
    MockUSDC       internal usdc;

    address internal treasury = address(0xBEEF01);
    address internal pauser   = address(0xBEEF02);
    address internal buyer    = address(0x1001);
    address internal supplier = address(0x1002);
    address internal arbiter  = address(0x1003);
    address internal buyRef   = address(0x1004);
    address internal supPay   = address(0x1005);

    uint16  internal constant FEE_BPS  = 100;  // 1%
    uint256 internal constant USDC_6   = 1e6;
    uint256 internal constant TOTAL    = 300 * USDC_6;
    uint16  internal constant INDEP    = type(uint16).max;

    // Attestor key constants
    uint256 internal constant ATT0_PK = 0xAA00;
    uint256 internal constant ATT1_PK = 0xAA01;
    uint256 internal constant ATT2_PK = 0xAA02;

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

    function _fundBuyer(uint256 amt) internal {
        usdc.mint(buyer, amt);
        vm.prank(buyer); usdc.approve(address(escrow), amt);
    }

    /// @dev Sign an EIP-712 attestation for a given deal/milestone/signer key.
    function _attest(uint256 dealId, uint8 msIdx, uint256 signerPk) internal {
        address signer = vm.addr(signerPk);
        uint64 t = uint64(block.timestamp);
        bytes32 evHash = keccak256(abi.encode("evidence", msIdx, signerPk));
        bytes32 structHash = keccak256(abi.encode(
            escrow.ATTESTATION_TYPEHASH(),
            dealId, uint256(msIdx),
            block.chainid, address(escrow),
            signer,
            escrow.STATEMENT_VERSION(),
            evHash, t, t + 1 days
        ));
        bytes32 digest = escrow.hashTypedDataV4(structHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPk, digest);
        bytes memory sig = abi.encodePacked(r, s, v);
        escrow.attest(dealId, msIdx, evHash, t, t + 1 days, signer, sig);
    }

    /// @dev Create a 3-milestone ACCEPTANCE deal where M1 depends on M0, M2 is independent.
    ///      M0=30% ACCEPTANCE, M1=30% ACCEPTANCE (dependsOn=0), M2=40% ACCEPTANCE independent.
    ///      After fund: M0=CLAIMABLE, M1=CLAIMABLE (but gated), M2=CLAIMABLE.
    function _createDependentDeal() internal returns (uint256 dealId) {
        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](3);
        ms[0] = IWaybillEscrow.MilestoneInput({
            bps: 3000,
            condition: IWaybillEscrow.ReleaseCondition.ACCEPTANCE,
            attestors: new address[](0),
            threshold: 0,
            deadline: uint64(block.timestamp + 30 days),
            gracePeriod: 72,
            reviewWindow: 0,
            dependsOn: INDEP       // independent
        });
        ms[1] = IWaybillEscrow.MilestoneInput({
            bps: 3000,
            condition: IWaybillEscrow.ReleaseCondition.ACCEPTANCE,
            attestors: new address[](0),
            threshold: 0,
            deadline: uint64(block.timestamp + 30 days),
            gracePeriod: 72,
            reviewWindow: 0,
            dependsOn: 0           // depends on M0
        });
        ms[2] = IWaybillEscrow.MilestoneInput({
            bps: 4000,
            condition: IWaybillEscrow.ReleaseCondition.ACCEPTANCE,
            attestors: new address[](0),
            threshold: 0,
            deadline: uint64(block.timestamp + 30 days),
            gracePeriod: 72,
            reviewWindow: 0,
            dependsOn: INDEP       // independent
        });

        uint256 totalFee = (TOTAL * FEE_BPS + 9999) / 10000;
        _fundBuyer(TOTAL + totalFee);

        vm.prank(buyer);
        dealId = escrow.createDeal(
            supplier, buyRef, arbiter, TOTAL, FEE_BPS,
            uint64(block.timestamp + 7 days), 168, ms
        );
        vm.prank(supplier); escrow.acceptSupplier(dealId, supPay);
        vm.prank(arbiter);  escrow.acceptArbiter(dealId);
        vm.prank(buyer);    escrow.fund(dealId);
    }

    /// @dev Create a 3-milestone ATTESTATION deal: M0=30%, M1=30% (dependsOn=0), M2=40% independent.
    function _createAttestDependentDeal() internal returns (uint256 dealId) {
        address att0 = vm.addr(ATT0_PK);
        address att1 = vm.addr(ATT1_PK);
        address att2 = vm.addr(ATT2_PK);
        address[] memory a0 = new address[](1); a0[0] = att0;
        address[] memory a1 = new address[](1); a1[0] = att1;
        address[] memory a2 = new address[](1); a2[0] = att2;

        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](3);
        ms[0] = IWaybillEscrow.MilestoneInput({
            bps: 3000,
            condition: IWaybillEscrow.ReleaseCondition.ATTESTATION,
            attestors: a0, threshold: 1,
            deadline: uint64(block.timestamp + 10 days),
            gracePeriod: 1, reviewWindow: 0,
            dependsOn: INDEP
        });
        ms[1] = IWaybillEscrow.MilestoneInput({
            bps: 3000,
            condition: IWaybillEscrow.ReleaseCondition.ATTESTATION,
            attestors: a1, threshold: 1,
            deadline: uint64(block.timestamp + 20 days),
            gracePeriod: 1, reviewWindow: 0,
            dependsOn: 0           // depends on M0
        });
        ms[2] = IWaybillEscrow.MilestoneInput({
            bps: 4000,
            condition: IWaybillEscrow.ReleaseCondition.ATTESTATION,
            attestors: a2, threshold: 1,
            deadline: uint64(block.timestamp + 30 days),
            gracePeriod: 1, reviewWindow: 0,
            dependsOn: INDEP
        });

        uint256 totalFee = (TOTAL * FEE_BPS + 9999) / 10000;
        _fundBuyer(TOTAL + totalFee);

        vm.prank(buyer);
        dealId = escrow.createDeal(
            supplier, buyRef, arbiter, TOTAL, FEE_BPS,
            uint64(block.timestamp + 7 days), 168, ms
        );
        vm.prank(supplier); escrow.acceptSupplier(dealId, supPay);
        vm.prank(arbiter);  escrow.acceptArbiter(dealId);
        // accept all attestors
        vm.prank(att0); escrow.acceptAttestor(dealId, 0);
        vm.prank(att1); escrow.acceptAttestor(dealId, 1);
        vm.prank(att2); escrow.acceptAttestor(dealId, 2);
        vm.prank(buyer); escrow.fund(dealId);
    }

    /// @dev Make a milestone REFUNDABLE: warp past its deadline+grace and call applyDefault.
    function _makeRefundable(uint256 dealId, uint8 msIdx) internal {
        IWaybillEscrow.Milestone memory ms = escrow.getMilestone(dealId, msIdx);
        uint64 graceEnd = ms.deadline + uint64(ms.gracePeriod) * 1 hours + 1;
        vm.warp(graceEnd);
        escrow.applyDefault(dealId, msIdx);
    }

    // =========================================================================
    // T1: Claim dependent before prerequisite release reverts DependencyNotReleased
    // =========================================================================
    function testDependent_ClaimBeforePrereq_Reverts() public {
        uint256 dealId = _createDependentDeal();

        // M0=CLAIMABLE, M1=CLAIMABLE but gated on M0 RELEASED
        assertEq(uint8(escrow.getMilestone(dealId, 1).state),
            uint8(IWaybillEscrow.MilestoneState.CLAIMABLE), "M1 CLAIMABLE");

        // Claim M1 before M0 released: must revert
        vm.expectRevert(IWaybillEscrow.DependencyNotReleased.selector);
        escrow.claim(dealId, 1);

        // dependsOnMilestone view returns 0 for M1
        assertEq(escrow.dependsOnMilestone(dealId, 1), 0, "M1 depends on M0");
    }

    // =========================================================================
    // T2: Release prerequisite then dependent claim succeeds exactly once
    // =========================================================================
    function testDependent_ClaimAfterPrereq_Succeeds() public {
        uint256 dealId = _createDependentDeal();
        uint256 lockedBefore = escrow.currentLocked();

        // Claim M0 (independent)
        uint256 supBefore = usdc.balanceOf(supPay);
        escrow.claim(dealId, 0);
        assertEq(uint8(escrow.getMilestone(dealId, 0).state),
            uint8(IWaybillEscrow.MilestoneState.RELEASED), "M0 RELEASED");

        // Now claim M1 (dependent on M0=RELEASED): must succeed
        escrow.claim(dealId, 1);
        assertEq(uint8(escrow.getMilestone(dealId, 1).state),
            uint8(IWaybillEscrow.MilestoneState.RELEASED), "M1 RELEASED");

        // Supplier received tranche0 + tranche1
        uint256 t0 = (TOTAL * 3000) / 10000;
        uint256 t1 = (TOTAL * 3000) / 10000;
        assertEq(usdc.balanceOf(supPay) - supBefore, t0 + t1, "supplier received M0+M1");

        // currentLocked decreased by t0+fee0 + t1+fee1
        uint256 fee0 = escrow.getTrancheFee(dealId, 0);
        uint256 fee1 = escrow.getTrancheFee(dealId, 1);
        assertEq(lockedBefore - escrow.currentLocked(), t0 + fee0 + t1 + fee1, "locked reduced by both");

        // Second claim on M1 reverts
        vm.expectRevert(IWaybillEscrow.NotClaimable.selector);
        escrow.claim(dealId, 1);
    }

    // =========================================================================
    // T3: Independent later milestone claims even while dependent is blocked
    // =========================================================================
    function testDependent_IndependentStillClaims() public {
        uint256 dealId = _createDependentDeal();

        // M2 is independent — claim it without releasing M0
        uint256 supBefore = usdc.balanceOf(supPay);
        escrow.claim(dealId, 2);
        assertEq(uint8(escrow.getMilestone(dealId, 2).state),
            uint8(IWaybillEscrow.MilestoneState.RELEASED), "M2 RELEASED independently");

        uint256 t2 = TOTAL - (TOTAL * 3000) / 10000 - (TOTAL * 3000) / 10000;
        assertEq(usdc.balanceOf(supPay) - supBefore, t2, "supplier received M2 only");
    }

    // =========================================================================
    // T4: Reject invalid dependency indices — self-ref, forward-ref, out-of-range
    // =========================================================================
    function testDependent_InvalidDependsOn_Reverts() public {
        uint256 totalFee = (TOTAL * FEE_BPS + 9999) / 10000;
        _fundBuyer(TOTAL + totalFee);

        // Self-reference: M0 dependsOn=0
        IWaybillEscrow.MilestoneInput[] memory ms1 = new IWaybillEscrow.MilestoneInput[](2);
        ms1[0] = IWaybillEscrow.MilestoneInput({
            bps: 5000, condition: IWaybillEscrow.ReleaseCondition.ACCEPTANCE,
            attestors: new address[](0), threshold: 0,
            deadline: uint64(block.timestamp + 1 days), gracePeriod: 1, reviewWindow: 0,
            dependsOn: 0           // self-reference on M0
        });
        ms1[1] = IWaybillEscrow.MilestoneInput({
            bps: 5000, condition: IWaybillEscrow.ReleaseCondition.ACCEPTANCE,
            attestors: new address[](0), threshold: 0,
            deadline: uint64(block.timestamp + 2 days), gracePeriod: 1, reviewWindow: 0,
            dependsOn: INDEP
        });
        vm.prank(buyer);
        vm.expectRevert(IWaybillEscrow.InvalidDependsOn.selector);
        escrow.createDeal(supplier, buyRef, arbiter, TOTAL, FEE_BPS,
            uint64(block.timestamp + 7 days), 168, ms1);

        // Forward-reference: M0 dependsOn=1 (references M1 which is later)
        IWaybillEscrow.MilestoneInput[] memory ms2 = new IWaybillEscrow.MilestoneInput[](2);
        ms2[0] = IWaybillEscrow.MilestoneInput({
            bps: 5000, condition: IWaybillEscrow.ReleaseCondition.ACCEPTANCE,
            attestors: new address[](0), threshold: 0,
            deadline: uint64(block.timestamp + 1 days), gracePeriod: 1, reviewWindow: 0,
            dependsOn: 1           // forward-reference to M1
        });
        ms2[1] = IWaybillEscrow.MilestoneInput({
            bps: 5000, condition: IWaybillEscrow.ReleaseCondition.ACCEPTANCE,
            attestors: new address[](0), threshold: 0,
            deadline: uint64(block.timestamp + 2 days), gracePeriod: 1, reviewWindow: 0,
            dependsOn: INDEP
        });
        vm.prank(buyer);
        vm.expectRevert(IWaybillEscrow.InvalidDependsOn.selector);
        escrow.createDeal(supplier, buyRef, arbiter, TOTAL, FEE_BPS,
            uint64(block.timestamp + 7 days), 168, ms2);

        // Out-of-range: M1 dependsOn=5 (no milestone 5 in a 2-milestone deal)
        IWaybillEscrow.MilestoneInput[] memory ms3 = new IWaybillEscrow.MilestoneInput[](2);
        ms3[0] = IWaybillEscrow.MilestoneInput({
            bps: 5000, condition: IWaybillEscrow.ReleaseCondition.ACCEPTANCE,
            attestors: new address[](0), threshold: 0,
            deadline: uint64(block.timestamp + 1 days), gracePeriod: 1, reviewWindow: 0,
            dependsOn: INDEP
        });
        ms3[1] = IWaybillEscrow.MilestoneInput({
            bps: 5000, condition: IWaybillEscrow.ReleaseCondition.ACCEPTANCE,
            attestors: new address[](0), threshold: 0,
            deadline: uint64(block.timestamp + 2 days), gracePeriod: 1, reviewWindow: 0,
            dependsOn: 5           // out of range (only M0 exists before M1)
        });
        vm.prank(buyer);
        vm.expectRevert(IWaybillEscrow.InvalidDependsOn.selector);
        escrow.createDeal(supplier, buyRef, arbiter, TOTAL, FEE_BPS,
            uint64(block.timestamp + 7 days), 168, ms3);

        // Sentinel (INDEP) creates an independent milestone — no revert
        IWaybillEscrow.MilestoneInput[] memory ms4 = new IWaybillEscrow.MilestoneInput[](2);
        ms4[0] = IWaybillEscrow.MilestoneInput({
            bps: 5000, condition: IWaybillEscrow.ReleaseCondition.ACCEPTANCE,
            attestors: new address[](0), threshold: 0,
            deadline: uint64(block.timestamp + 1 days), gracePeriod: 1, reviewWindow: 0,
            dependsOn: INDEP
        });
        ms4[1] = IWaybillEscrow.MilestoneInput({
            bps: 5000, condition: IWaybillEscrow.ReleaseCondition.ACCEPTANCE,
            attestors: new address[](0), threshold: 0,
            deadline: uint64(block.timestamp + 2 days), gracePeriod: 1, reviewWindow: 0,
            dependsOn: INDEP
        });
        vm.prank(buyer);
        uint256 did = escrow.createDeal(supplier, buyRef, arbiter, TOTAL, FEE_BPS,
            uint64(block.timestamp + 7 days), 168, ms4);
        // Both milestones independent
        assertEq(escrow.dependsOnMilestone(did, 0), INDEP, "M0 independent");
        assertEq(escrow.dependsOnMilestone(did, 1), INDEP, "M1 independent");
    }

    // =========================================================================
    // T5: Dependency DISPUTED blocks dependent claim/approval; locked unchanged
    // =========================================================================
    function testDependent_DepDisputedBlocksClaim() public {
        // Need M0 in IN_REVIEW so buyer can raise a dispute (BuyerDisputeNotInReview guard).
        // Create a 2-milestone deal: M0=ACCEPTANCE with reviewWindow=1h, M1=ACCEPTANCE dep=0.
        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](2);
        ms[0] = IWaybillEscrow.MilestoneInput({
            bps: 5000, condition: IWaybillEscrow.ReleaseCondition.ACCEPTANCE,
            attestors: new address[](0), threshold: 0,
            deadline: uint64(block.timestamp + 30 days), gracePeriod: 72,
            reviewWindow: 1,   // 1h review window so M0 goes IN_REVIEW on fund
            dependsOn: INDEP
        });
        ms[1] = IWaybillEscrow.MilestoneInput({
            bps: 5000, condition: IWaybillEscrow.ReleaseCondition.ACCEPTANCE,
            attestors: new address[](0), threshold: 0,
            deadline: uint64(block.timestamp + 30 days), gracePeriod: 72,
            reviewWindow: 0,
            dependsOn: 0       // depends on M0
        });
        uint256 totalFee = (TOTAL * FEE_BPS + 9999) / 10000;
        _fundBuyer(TOTAL + totalFee);
        vm.prank(buyer);
        uint256 dealId = escrow.createDeal(supplier, buyRef, arbiter, TOTAL, FEE_BPS,
            uint64(block.timestamp + 7 days), 168, ms);
        vm.prank(supplier); escrow.acceptSupplier(dealId, supPay);
        vm.prank(arbiter);  escrow.acceptArbiter(dealId);
        vm.prank(buyer);    escrow.fund(dealId);

        // M0 is IN_REVIEW after fund (reviewWindow=1h)
        assertEq(uint8(escrow.getMilestone(dealId, 0).state),
            uint8(IWaybillEscrow.MilestoneState.IN_REVIEW), "M0 IN_REVIEW after fund");

        // Buyer raises a dispute on M0 from IN_REVIEW state
        vm.prank(buyer);
        escrow.dispute(dealId, 0, keccak256("dispute-evidence"));

        assertEq(uint8(escrow.getMilestone(dealId, 0).state),
            uint8(IWaybillEscrow.MilestoneState.DISPUTED), "M0 DISPUTED");

        uint256 lockedBefore = escrow.currentLocked();

        // Trying to claim M1 (depends on M0) while M0 is DISPUTED: must revert DependencyNotReleased
        vm.expectRevert(IWaybillEscrow.DependencyNotReleased.selector);
        escrow.claim(dealId, 1);

        // currentLocked unchanged
        assertEq(escrow.currentLocked(), lockedBefore, "locked unchanged while dep DISPUTED");
    }

    // =========================================================================
    // T6: approveMilestone on dependent blocked by unreleased prerequisite
    // =========================================================================
    function testDependent_ApproveMilestoneGated() public {
        // Create a deal where M0=ACCEPTANCE, M1=BUYER_APPROVAL (dependsOn=0)
        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](2);
        ms[0] = IWaybillEscrow.MilestoneInput({
            bps: 5000, condition: IWaybillEscrow.ReleaseCondition.ACCEPTANCE,
            attestors: new address[](0), threshold: 0,
            deadline: uint64(block.timestamp + 30 days), gracePeriod: 72, reviewWindow: 0,
            dependsOn: INDEP
        });
        ms[1] = IWaybillEscrow.MilestoneInput({
            bps: 5000, condition: IWaybillEscrow.ReleaseCondition.BUYER_APPROVAL,
            attestors: new address[](0), threshold: 0,
            deadline: uint64(block.timestamp + 30 days), gracePeriod: 72, reviewWindow: 0,
            dependsOn: 0           // depends on M0
        });

        uint256 totalFee = (TOTAL * FEE_BPS + 9999) / 10000;
        _fundBuyer(TOTAL + totalFee);
        vm.prank(buyer);
        uint256 dealId = escrow.createDeal(supplier, buyRef, arbiter, TOTAL, FEE_BPS,
            uint64(block.timestamp + 7 days), 168, ms);
        vm.prank(supplier); escrow.acceptSupplier(dealId, supPay);
        vm.prank(arbiter);  escrow.acceptArbiter(dealId);
        vm.prank(buyer);    escrow.fund(dealId);

        // approveMilestone on M1 before M0 released: must revert
        vm.prank(buyer);
        vm.expectRevert(IWaybillEscrow.DependencyNotReleased.selector);
        escrow.approveMilestone(dealId, 1);

        // Claim M0 to release it
        escrow.claim(dealId, 0);

        // Now approveMilestone M1 succeeds
        vm.prank(buyer);
        escrow.approveMilestone(dealId, 1);
        assertEq(uint8(escrow.getMilestone(dealId, 1).state),
            uint8(IWaybillEscrow.MilestoneState.CLAIMABLE), "M1 CLAIMABLE after approval");
    }

    // =========================================================================
    // T7: Dependency refund cascades to dependent unreleased tranche exactly once
    // =========================================================================
    function testDependent_DepRefund_CascadesDependent() public {
        uint256 dealId = _createAttestDependentDeal();
        // M0=WAITING, M1=WAITING (dep=0), M2=WAITING (independent)

        // Make M0 REFUNDABLE (miss deadline+grace)
        _makeRefundable(dealId, 0);
        assertEq(uint8(escrow.getMilestone(dealId, 0).state),
            uint8(IWaybillEscrow.MilestoneState.REFUNDABLE), "M0 REFUNDABLE");

        uint256 lockedBefore = escrow.currentLocked();
        uint256 buyBefore    = usdc.balanceOf(buyRef);

        // Refund M0: cascade should sweep M1 (WAITING, dependent) and M2 (WAITING, independent)
        escrow.refund(dealId, 0);

        // All three milestones must be REFUNDED
        assertEq(uint8(escrow.getMilestone(dealId, 0).state),
            uint8(IWaybillEscrow.MilestoneState.REFUNDED), "M0 REFUNDED");
        assertEq(uint8(escrow.getMilestone(dealId, 1).state),
            uint8(IWaybillEscrow.MilestoneState.REFUNDED), "M1 cascaded REFUNDED");
        assertEq(uint8(escrow.getMilestone(dealId, 2).state),
            uint8(IWaybillEscrow.MilestoneState.REFUNDED), "M2 cascaded REFUNDED");

        // Deal SETTLED
        assertEq(uint8(escrow.getDeal(dealId).state),
            uint8(IWaybillEscrow.DealState.SETTLED), "deal SETTLED");

        // Buyer received entire TOTAL + totalFee
        uint256 totalFee = (TOTAL * FEE_BPS + 9999) / 10000;
        assertEq(usdc.balanceOf(buyRef) - buyBefore, TOTAL + totalFee, "buyer got all back");

        // currentLocked delta = TOTAL + totalFee
        assertEq(lockedBefore - escrow.currentLocked(), TOTAL + totalFee, "locked fully released");
    }

    // =========================================================================
    // T8: Cascade refund to dependent blocked buyer — retry delivers exactly once
    // =========================================================================
    function testDependent_CascadeBlockedBuyer_RetryDelivers() public {
        uint256 dealId = _createAttestDependentDeal();

        // Block buyRef to simulate USDC blocklist
        usdc.blockAddr(buyRef);

        _makeRefundable(dealId, 0);

        uint256 lockedBefore = escrow.currentLocked();

        // Refund M0: M0 transfer fails (blocked) → M0 stays REFUNDABLE
        // Cascade tries M1 and M2 → both blocked → both REFUNDABLE with pending
        escrow.refund(dealId, 0);

        // M0 back to REFUNDABLE (trigger transfer failed)
        assertEq(uint8(escrow.getMilestone(dealId, 0).state),
            uint8(IWaybillEscrow.MilestoneState.REFUNDABLE), "M0 REFUNDABLE after blocked trigger");
        // M1 cascade blocked → REFUNDABLE with pending
        assertEq(uint8(escrow.getMilestone(dealId, 1).state),
            uint8(IWaybillEscrow.MilestoneState.REFUNDABLE), "M1 REFUNDABLE after blocked cascade");
        // M2 cascade blocked → REFUNDABLE with pending
        assertEq(uint8(escrow.getMilestone(dealId, 2).state),
            uint8(IWaybillEscrow.MilestoneState.REFUNDABLE), "M2 REFUNDABLE after blocked cascade");

        // All pending stored
        assertGt(escrow.cascadeRefundPending(dealId, 1), 0, "M1 pending > 0");
        assertGt(escrow.cascadeRefundPending(dealId, 2), 0, "M2 pending > 0");

        // currentLocked unchanged (no delivery yet)
        assertEq(escrow.currentLocked(), lockedBefore, "locked unchanged while all blocked");

        // Deal not settled
        assertEq(uint8(escrow.getDeal(dealId).state),
            uint8(IWaybillEscrow.DealState.FUNDED), "deal not SETTLED while blocked");

        // Unblock buyer, retry cascade for M1 and M2
        usdc.unblockAddr(buyRef);
        uint256 m1pending = escrow.cascadeRefundPending(dealId, 1);
        uint256 m2pending = escrow.cascadeRefundPending(dealId, 2);

        uint256 buyBefore = usdc.balanceOf(buyRef);
        escrow.retryCascadeRefund(dealId, 1);
        escrow.retryCascadeRefund(dealId, 2);

        assertEq(uint8(escrow.getMilestone(dealId, 1).state),
            uint8(IWaybillEscrow.MilestoneState.REFUNDED), "M1 REFUNDED after retry");
        assertEq(uint8(escrow.getMilestone(dealId, 2).state),
            uint8(IWaybillEscrow.MilestoneState.REFUNDED), "M2 REFUNDED after retry");

        assertEq(escrow.cascadeRefundPending(dealId, 1), 0, "M1 pending cleared");
        assertEq(escrow.cascadeRefundPending(dealId, 2), 0, "M2 pending cleared");

        // Buyer received M1+M2 pending amounts
        assertEq(usdc.balanceOf(buyRef) - buyBefore, m1pending + m2pending, "buyer got M1+M2");

        // Now refund M0 trigger directly (M0 is still REFUNDABLE)
        uint256 m0amt = usdc.balanceOf(buyRef);
        escrow.refund(dealId, 0);
        assertGt(usdc.balanceOf(buyRef) - m0amt, 0, "buyer got M0 on trigger refund");

        // Deal now SETTLED
        assertEq(uint8(escrow.getDeal(dealId).state),
            uint8(IWaybillEscrow.DealState.SETTLED), "deal SETTLED after all refunded");

        // Second retry reverts
        vm.expectRevert(IWaybillEscrow.CascadeRefundNotPending.selector);
        escrow.retryCascadeRefund(dealId, 1);
    }

    // =========================================================================
    // T9: Released dependent is not swept by subsequent cascade
    // =========================================================================
    function testDependent_ReleasedNotTouched_ByCascade() public {
        uint256 dealId = _createAttestDependentDeal();

        // Attest and claim M0 (independent)
        _attest(dealId, 0, ATT0_PK);
        escrow.claim(dealId, 0);
        assertEq(uint8(escrow.getMilestone(dealId, 0).state),
            uint8(IWaybillEscrow.MilestoneState.RELEASED), "M0 RELEASED");

        // Attest and claim M1 (dependent on M0 — now released)
        _attest(dealId, 1, ATT1_PK);
        escrow.claim(dealId, 1);
        assertEq(uint8(escrow.getMilestone(dealId, 1).state),
            uint8(IWaybillEscrow.MilestoneState.RELEASED), "M1 RELEASED");

        // Make M2 REFUNDABLE and refund it
        _makeRefundable(dealId, 2);
        uint256 buyBefore = usdc.balanceOf(buyRef);
        escrow.refund(dealId, 2);

        // M0 and M1 must remain RELEASED — cascade only goes forward from M2 (no later milestones)
        assertEq(uint8(escrow.getMilestone(dealId, 0).state),
            uint8(IWaybillEscrow.MilestoneState.RELEASED), "M0 still RELEASED");
        assertEq(uint8(escrow.getMilestone(dealId, 1).state),
            uint8(IWaybillEscrow.MilestoneState.RELEASED), "M1 still RELEASED");
        assertEq(uint8(escrow.getMilestone(dealId, 2).state),
            uint8(IWaybillEscrow.MilestoneState.REFUNDED), "M2 REFUNDED");

        // Deal SETTLED (all milestones terminal)
        assertEq(uint8(escrow.getDeal(dealId).state),
            uint8(IWaybillEscrow.DealState.SETTLED), "deal SETTLED");

        // Buyer got only M2 refund
        uint256 t2 = TOTAL - (TOTAL * 3000) / 10000 - (TOTAL * 3000) / 10000;
        uint256 fee2 = escrow.getTrancheFee(dealId, 2);
        assertEq(usdc.balanceOf(buyRef) - buyBefore, t2 + fee2, "buyer got M2 only");
    }

    // =========================================================================
    // T10: Mixed chain — released M0, dependent M1 claims, M2 independent unaffected
    // =========================================================================
    function testDependent_MixedChain_BypassRejected() public {
        uint256 dealId = _createDependentDeal();
        // M0=CLAIMABLE, M1=CLAIMABLE (dep=0), M2=CLAIMABLE (independent)

        // Confirm M1 cannot be claimed before M0
        vm.expectRevert(IWaybillEscrow.DependencyNotReleased.selector);
        escrow.claim(dealId, 1);

        // M2 (independent) can be claimed freely
        escrow.claim(dealId, 2);
        assertEq(uint8(escrow.getMilestone(dealId, 2).state),
            uint8(IWaybillEscrow.MilestoneState.RELEASED), "M2 RELEASED");

        // M1 still gated even after M2 claimed
        vm.expectRevert(IWaybillEscrow.DependencyNotReleased.selector);
        escrow.claim(dealId, 1);

        // Release M0 — now M1 can be claimed
        escrow.claim(dealId, 0);
        escrow.claim(dealId, 1);
        assertEq(uint8(escrow.getMilestone(dealId, 1).state),
            uint8(IWaybillEscrow.MilestoneState.RELEASED), "M1 RELEASED after M0");

        // Deal SETTLED
        assertEq(uint8(escrow.getDeal(dealId).state),
            uint8(IWaybillEscrow.DealState.SETTLED), "deal SETTLED");
    }

    // =========================================================================
    // T11: dependsOnMilestone view returns correct values
    // =========================================================================
    function testDependent_ViewReturnsCorrectDepsOn() public {
        uint256 dealId = _createDependentDeal();
        assertEq(escrow.dependsOnMilestone(dealId, 0), INDEP, "M0 independent");
        assertEq(escrow.dependsOnMilestone(dealId, 1), 0,     "M1 depends on M0");
        assertEq(escrow.dependsOnMilestone(dealId, 2), INDEP, "M2 independent");
    }
}
