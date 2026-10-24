// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test}             from "forge-std/Test.sol";
import {IWaybillEscrow}   from "../../src/interfaces/IWaybillEscrow.sol";
import {WaybillEscrow}    from "../../src/core/WaybillEscrow.sol";
import {ArbiterList}      from "../../src/registry/ArbiterList.sol";
import {AttestorRegistry} from "../../src/registry/AttestorRegistry.sol";
import {MockUSDC}         from "../integration/WaybillEscrow.t.sol";

/// @title Panel04h break-oriented tests for 3-member panel arbitration.
contract Panel04h is Test {
    // ── constants ────────────────────────────────────────────────────────────
    uint256 constant TOTAL   = 1_000e6;   // 1,000 USDC
    uint16  constant FEE_BPS = 100;       // 1%

    // ── actors ───────────────────────────────────────────────────────────────
    address buyer         = makeAddr("buyer");
    address supplier      = makeAddr("supplier");
    address supplierPay   = makeAddr("supplierPay");
    address buyerRef      = makeAddr("buyerRef");

    // panel members
    address p0            = makeAddr("panel0");
    address p1            = makeAddr("panel1");
    address p2            = makeAddr("panel2");

    // single-arbiter (for isolation tests)
    address singleArbiter = makeAddr("singleArbiter");

    address treasury      = makeAddr("treasury");

    // ── contracts ─────────────────────────────────────────────────────────────
    MockUSDC          usdc;
    ArbiterList       list;
    AttestorRegistry  registry;
    WaybillEscrow     escrow;

    // ── vote encoding helpers ─────────────────────────────────────────────────
    uint32 constant VOTE_BUYER    = 1;
    uint32 constant VOTE_SUPPLIER = 2;
    function voteSplit(uint16 supplierBps) internal pure returns (uint32) {
        // supplierBps in [1..9999]; encodes as supplierBps + 3
        return uint32(supplierBps) + 3;
    }

    // =========================================================================
    // setUp
    // =========================================================================

    function setUp() public {
        usdc     = new MockUSDC();
        address[] memory initialArbiters = new address[](4);
        initialArbiters[0] = p0;
        initialArbiters[1] = p1;
        initialArbiters[2] = p2;
        initialArbiters[3] = singleArbiter;
        list     = new ArbiterList(address(this), initialArbiters);
        registry = new AttestorRegistry(address(this));
        escrow   = new WaybillEscrow(
            address(usdc), treasury, address(this),
            100_000e6, 100_000e6,
            address(list), address(registry)
        );

        // Fund accounts
        usdc.mint(buyer, 50_000e6);
        vm.prank(buyer);
        usdc.approve(address(escrow), type(uint256).max);
    }

    // =========================================================================
    // Helpers
    // =========================================================================

    /// Single ACCEPTANCE milestone, returns dealId for a panel deal.
    function _createPanelDeal() internal returns (uint256 dealId) {
        address[] memory panel = new address[](3);
        panel[0] = p0; panel[1] = p1; panel[2] = p2;

        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](1);
        ms[0] = IWaybillEscrow.MilestoneInput({
            bps: 10_000, condition: IWaybillEscrow.ReleaseCondition.ACCEPTANCE,
            attestors: new address[](0), threshold: 0,
            deadline: 0, gracePeriod: 0, reviewWindow: 1,  // reviewWindow=1 so buyer can dispute
            dependsOn: type(uint16).max
        });

        vm.prank(buyer);
        dealId = escrow.createDealWithPanel(
            supplier, buyerRef, address(0), panel, TOTAL, FEE_BPS,
            uint64(block.timestamp + 7 days), 72, ms,
            false, 0, IWaybillEscrow.FeePayer.BuyerPrepaid
        );
    }

    /// All three panel members accept, supplier accepts, then buyer funds.
    function _acceptAndFund(uint256 dealId) internal {
        vm.prank(supplier);
        escrow.acceptSupplier(dealId, supplierPay);
        vm.prank(p0); escrow.acceptArbiter(dealId);
        vm.prank(p1); escrow.acceptArbiter(dealId);
        vm.prank(p2); escrow.acceptArbiter(dealId);
        vm.prank(buyer); escrow.fund(dealId);
    }

    /// Raise a dispute on milestone 0 from the buyer (IN_REVIEW state).
    function _dispute(uint256 dealId) internal {
        // warp so reviewWindow started; then buyer disputes
        vm.prank(buyer);
        escrow.dispute(dealId, 0, keccak256("buyer-dispute"));
        // warp past response window so panel can vote
        vm.warp(block.timestamp + 73 hours);
    }

    // =========================================================================
    // T1: Panel creation validation
    // =========================================================================

    function testT1a_PanelWrongSize_Reverts() public {
        address[] memory panel = new address[](2);
        panel[0] = p0; panel[1] = p1;
        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](1);
        ms[0] = IWaybillEscrow.MilestoneInput({
            bps: 10_000, condition: IWaybillEscrow.ReleaseCondition.ACCEPTANCE,
            attestors: new address[](0), threshold: 0,
            deadline: 0, gracePeriod: 0, reviewWindow: 0, dependsOn: type(uint16).max
        });
        vm.prank(buyer);
        vm.expectRevert(IWaybillEscrow.InvalidPanelSize.selector);
        escrow.createDealWithPanel(
            supplier, buyerRef, address(0), panel, TOTAL, FEE_BPS,
            uint64(block.timestamp + 7 days), 72, ms, false, 0, IWaybillEscrow.FeePayer.BuyerPrepaid
        );
    }

    function testT1b_PanelMemberZero_Reverts() public {
        address[] memory panel = new address[](3);
        panel[0] = p0; panel[1] = address(0); panel[2] = p2;
        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](1);
        ms[0] = IWaybillEscrow.MilestoneInput({
            bps: 10_000, condition: IWaybillEscrow.ReleaseCondition.ACCEPTANCE,
            attestors: new address[](0), threshold: 0,
            deadline: 0, gracePeriod: 0, reviewWindow: 0, dependsOn: type(uint16).max
        });
        vm.prank(buyer);
        vm.expectRevert(IWaybillEscrow.PanelMemberZero.selector);
        escrow.createDealWithPanel(
            supplier, buyerRef, address(0), panel, TOTAL, FEE_BPS,
            uint64(block.timestamp + 7 days), 72, ms, false, 0, IWaybillEscrow.FeePayer.BuyerPrepaid
        );
    }

    function testT1c_PanelDuplicate_Reverts() public {
        address[] memory panel = new address[](3);
        panel[0] = p0; panel[1] = p0; panel[2] = p2;  // duplicate p0
        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](1);
        ms[0] = IWaybillEscrow.MilestoneInput({
            bps: 10_000, condition: IWaybillEscrow.ReleaseCondition.ACCEPTANCE,
            attestors: new address[](0), threshold: 0,
            deadline: 0, gracePeriod: 0, reviewWindow: 0, dependsOn: type(uint16).max
        });
        vm.prank(buyer);
        vm.expectRevert(IWaybillEscrow.PanelMemberDuplicate.selector);
        escrow.createDealWithPanel(
            supplier, buyerRef, address(0), panel, TOTAL, FEE_BPS,
            uint64(block.timestamp + 7 days), 72, ms, false, 0, IWaybillEscrow.FeePayer.BuyerPrepaid
        );
    }

    function testT1d_PanelMemberNotAllowed_Reverts() public {
        address notAllowed = makeAddr("notAllowed");
        address[] memory panel = new address[](3);
        panel[0] = p0; panel[1] = p1; panel[2] = notAllowed;
        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](1);
        ms[0] = IWaybillEscrow.MilestoneInput({
            bps: 10_000, condition: IWaybillEscrow.ReleaseCondition.ACCEPTANCE,
            attestors: new address[](0), threshold: 0,
            deadline: 0, gracePeriod: 0, reviewWindow: 0, dependsOn: type(uint16).max
        });
        vm.prank(buyer);
        vm.expectRevert(IWaybillEscrow.PanelMemberNotAllowed.selector);
        escrow.createDealWithPanel(
            supplier, buyerRef, address(0), panel, TOTAL, FEE_BPS,
            uint64(block.timestamp + 7 days), 72, ms, false, 0, IWaybillEscrow.FeePayer.BuyerPrepaid
        );
    }

    function testT1e_PanelMemberIsSupplier_Reverts() public {
        // add supplier to list first
        list.scheduleAddArbiter(supplier, 0);
        vm.warp(block.timestamp + 48 hours + 1);
        list.executeAddArbiter(supplier);

        address[] memory panel = new address[](3);
        panel[0] = p0; panel[1] = p1; panel[2] = supplier;
        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](1);
        ms[0] = IWaybillEscrow.MilestoneInput({
            bps: 10_000, condition: IWaybillEscrow.ReleaseCondition.ACCEPTANCE,
            attestors: new address[](0), threshold: 0,
            deadline: 0, gracePeriod: 0, reviewWindow: 0, dependsOn: type(uint16).max
        });
        vm.prank(buyer);
        vm.expectRevert(IWaybillEscrow.PanelMemberIsSupplier.selector);
        escrow.createDealWithPanel(
            supplier, buyerRef, address(0), panel, TOTAL, FEE_BPS,
            uint64(block.timestamp + 7 days), 72, ms, false, 0, IWaybillEscrow.FeePayer.BuyerPrepaid
        );
    }

    function testT1f_EmptyPanel_RoutesToSingleArbiter() public {
        // Empty panel = legacy single-arbiter; arbiter arg is used normally.
        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](1);
        ms[0] = IWaybillEscrow.MilestoneInput({
            bps: 10_000, condition: IWaybillEscrow.ReleaseCondition.ACCEPTANCE,
            attestors: new address[](0), threshold: 0,
            deadline: 0, gracePeriod: 0, reviewWindow: 0, dependsOn: type(uint16).max
        });
        address[] memory emptyPanel = new address[](0);
        vm.prank(buyer);
        uint256 dealId = escrow.createDealWithPanel(
            supplier, buyerRef, singleArbiter, emptyPanel, TOTAL, FEE_BPS,
            uint64(block.timestamp + 7 days), 72, ms, false, 0, IWaybillEscrow.FeePayer.BuyerPrepaid
        );
        // Must be a single-arbiter deal, not a panel deal
        assertFalse(escrow.isPanelDeal(dealId), "T1f: empty panel is single-arbiter deal");
        IWaybillEscrow.Deal memory deal = escrow.getDeal(dealId);
        assertEq(deal.arbiter, singleArbiter, "T1f: arbiter set from arg");
    }

    function testT1g_PanelLengthTwo_Reverts() public {
        // Length != 0 and != 3 must revert InvalidPanelSize
        address[] memory panel = new address[](2);
        panel[0] = p0; panel[1] = p1;
        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](1);
        ms[0] = IWaybillEscrow.MilestoneInput({
            bps: 10_000, condition: IWaybillEscrow.ReleaseCondition.ACCEPTANCE,
            attestors: new address[](0), threshold: 0,
            deadline: 0, gracePeriod: 0, reviewWindow: 0, dependsOn: type(uint16).max
        });
        vm.prank(buyer);
        vm.expectRevert(IWaybillEscrow.InvalidPanelSize.selector);
        escrow.createDealWithPanel(
            supplier, buyerRef, address(0), panel, TOTAL, FEE_BPS,
            uint64(block.timestamp + 7 days), 72, ms, false, 0, IWaybillEscrow.FeePayer.BuyerPrepaid
        );
    }

    function testT1h_PanelMember0_IsAttestor_Reverts() public {
        // panel[0] used as nominal arbiter; _createDealCore rejects it via AttestorIsArbiter
        address attestor0 = p0; // p0 is panel[0] and also in attestors
        address[] memory panel = new address[](3);
        panel[0] = attestor0; panel[1] = p1; panel[2] = p2;

        address[] memory atts = new address[](1);
        atts[0] = attestor0;

        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](1);
        ms[0] = IWaybillEscrow.MilestoneInput({
            bps: 10_000, condition: IWaybillEscrow.ReleaseCondition.ATTESTATION,
            attestors: atts, threshold: 1,
            deadline: uint64(block.timestamp + 7 days), gracePeriod: 0, reviewWindow: 0,
            dependsOn: type(uint16).max
        });
        vm.prank(buyer);
        vm.expectRevert(IWaybillEscrow.AttestorIsArbiter.selector);
        escrow.createDealWithPanel(
            supplier, buyerRef, address(0), panel, TOTAL, FEE_BPS,
            uint64(block.timestamp + 7 days), 72, ms, false, 0, IWaybillEscrow.FeePayer.BuyerPrepaid
        );
    }

    function testT1i_PanelMember1_IsAttestor_Reverts() public {
        // panel[1] appears as attestor in an ATTESTATION milestone
        address[] memory panel = new address[](3);
        panel[0] = p0; panel[1] = p1; panel[2] = p2;

        address[] memory atts = new address[](1);
        atts[0] = p1; // p1 = panel[1]

        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](1);
        ms[0] = IWaybillEscrow.MilestoneInput({
            bps: 10_000, condition: IWaybillEscrow.ReleaseCondition.ATTESTATION,
            attestors: atts, threshold: 1,
            deadline: uint64(block.timestamp + 7 days), gracePeriod: 0, reviewWindow: 0,
            dependsOn: type(uint16).max
        });
        vm.prank(buyer);
        vm.expectRevert(IWaybillEscrow.PanelMemberIsAttestor.selector);
        escrow.createDealWithPanel(
            supplier, buyerRef, address(0), panel, TOTAL, FEE_BPS,
            uint64(block.timestamp + 7 days), 72, ms, false, 0, IWaybillEscrow.FeePayer.BuyerPrepaid
        );
    }

    function testT1j_PanelMember2_IsAttestor_Reverts() public {
        // panel[2] appears as attestor in an ATTESTATION milestone
        address[] memory panel = new address[](3);
        panel[0] = p0; panel[1] = p1; panel[2] = p2;

        address[] memory atts = new address[](1);
        atts[0] = p2; // p2 = panel[2]

        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](1);
        ms[0] = IWaybillEscrow.MilestoneInput({
            bps: 10_000, condition: IWaybillEscrow.ReleaseCondition.ATTESTATION,
            attestors: atts, threshold: 1,
            deadline: uint64(block.timestamp + 7 days), gracePeriod: 0, reviewWindow: 0,
            dependsOn: type(uint16).max
        });
        vm.prank(buyer);
        vm.expectRevert(IWaybillEscrow.PanelMemberIsAttestor.selector);
        escrow.createDealWithPanel(
            supplier, buyerRef, address(0), panel, TOTAL, FEE_BPS,
            uint64(block.timestamp + 7 days), 72, ms, false, 0, IWaybillEscrow.FeePayer.BuyerPrepaid
        );
    }

    function testT1k_EmptyPanel_SingleArbiter_FullFlow() public {
        // Verify the empty-panel single-arbiter path works end-to-end (accept + fund + claim)
        address[] memory emptyPanel = new address[](0);
        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](1);
        ms[0] = IWaybillEscrow.MilestoneInput({
            bps: 10_000, condition: IWaybillEscrow.ReleaseCondition.ACCEPTANCE,
            attestors: new address[](0), threshold: 0,
            deadline: 0, gracePeriod: 0, reviewWindow: 0, dependsOn: type(uint16).max
        });
        vm.prank(buyer);
        uint256 dealId = escrow.createDealWithPanel(
            supplier, buyerRef, singleArbiter, emptyPanel, TOTAL, FEE_BPS,
            uint64(block.timestamp + 7 days), 72, ms, false, 0, IWaybillEscrow.FeePayer.BuyerPrepaid
        );
        // Single-arbiter flow: supplier + arbiter accept, buyer funds, supplier claims
        vm.prank(supplier); escrow.acceptSupplier(dealId, supplierPay);
        vm.prank(singleArbiter); escrow.acceptArbiter(dealId);
        vm.prank(buyer); escrow.fund(dealId);
        uint256 supBefore = usdc.balanceOf(supplierPay);
        vm.prank(supplier); escrow.claim(dealId, 0);
        assertGt(usdc.balanceOf(supplierPay), supBefore, "T1k: supplier received tranche");
        IWaybillEscrow.Deal memory deal = escrow.getDeal(dealId);
        assertEq(uint8(deal.state), uint8(IWaybillEscrow.DealState.SETTLED), "T1k: settled");
    }

    // =========================================================================
    // T2: isPanelDeal and getPanelMembers
    // =========================================================================

    function testT2_IsPanelDeal_And_GetPanelMembers() public {
        uint256 panelDealId  = _createPanelDeal();

        // Single-arbiter deal for comparison
        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](1);
        ms[0] = IWaybillEscrow.MilestoneInput({
            bps: 10_000, condition: IWaybillEscrow.ReleaseCondition.ACCEPTANCE,
            attestors: new address[](0), threshold: 0,
            deadline: 0, gracePeriod: 0, reviewWindow: 0, dependsOn: type(uint16).max
        });
        vm.prank(buyer);
        uint256 singleDealId = escrow.createDeal(
            supplier, buyerRef, singleArbiter, TOTAL, FEE_BPS,
            uint64(block.timestamp + 7 days), 72, ms
        );

        assertTrue(escrow.isPanelDeal(panelDealId),   "T2: panel deal is panel");
        assertFalse(escrow.isPanelDeal(singleDealId), "T2: single-arbiter deal is not panel");

        address[3] memory members = escrow.getPanelMembers(panelDealId);
        assertEq(members[0], p0, "T2: panel[0]");
        assertEq(members[1], p1, "T2: panel[1]");
        assertEq(members[2], p2, "T2: panel[2]");

        address[3] memory singleMembers = escrow.getPanelMembers(singleDealId);
        assertEq(singleMembers[0], address(0), "T2: single has no panel[0]");
    }

    // =========================================================================
    // T3: All three accepts required before fund; partial accept does not unlock fund
    // =========================================================================

    function testT3_FundRequiresAllThreeAccepts() public {
        uint256 dealId = _createPanelDeal();

        vm.prank(supplier);
        escrow.acceptSupplier(dealId, supplierPay);
        // Only p0 and p1 accept
        vm.prank(p0); escrow.acceptArbiter(dealId);
        vm.prank(p1); escrow.acceptArbiter(dealId);

        // Fund should fail: p2 has not accepted
        vm.prank(buyer);
        vm.expectRevert(IWaybillEscrow.NotFullyAccepted.selector);
        escrow.fund(dealId);

        // p2 accepts
        vm.prank(p2); escrow.acceptArbiter(dealId);

        // Now fund succeeds
        vm.prank(buyer);
        escrow.fund(dealId);
        IWaybillEscrow.Deal memory deal = escrow.getDeal(dealId);
        assertEq(uint8(deal.state), uint8(IWaybillEscrow.DealState.FUNDED), "T3: funded after all three accept");
    }

    function testT3_NonPanelMember_AcceptArbiter_Reverts() public {
        uint256 dealId = _createPanelDeal();
        address stranger = makeAddr("stranger");

        vm.prank(stranger);
        vm.expectRevert(IWaybillEscrow.NotPanelMember.selector);
        escrow.acceptArbiter(dealId);
    }

    function testT3_DuplicateAccept_Reverts() public {
        uint256 dealId = _createPanelDeal();
        vm.prank(p0); escrow.acceptArbiter(dealId);
        vm.prank(p0);
        vm.expectRevert(IWaybillEscrow.AlreadyAccepted.selector);
        escrow.acceptArbiter(dealId);
    }

    // =========================================================================
    // T4: Single-arbiter deal cannot use castPanelVote
    // =========================================================================

    function testT4_CastPanelVote_OnSingleArbiterDeal_Reverts() public {
        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](1);
        ms[0] = IWaybillEscrow.MilestoneInput({
            bps: 10_000, condition: IWaybillEscrow.ReleaseCondition.ACCEPTANCE,
            attestors: new address[](0), threshold: 0,
            deadline: 0, gracePeriod: 0, reviewWindow: 1, dependsOn: type(uint16).max
        });
        vm.prank(buyer);
        uint256 dealId = escrow.createDeal(
            supplier, buyerRef, singleArbiter, TOTAL, FEE_BPS,
            uint64(block.timestamp + 7 days), 72, ms
        );
        vm.prank(supplier); escrow.acceptSupplier(dealId, supplierPay);
        vm.prank(singleArbiter); escrow.acceptArbiter(dealId);
        vm.prank(buyer); escrow.fund(dealId);
        vm.prank(buyer); escrow.dispute(dealId, 0, keccak256("ev"));
        vm.warp(block.timestamp + 73 hours);

        vm.prank(singleArbiter);
        vm.expectRevert(IWaybillEscrow.IsPanelDeal.selector);
        escrow.castPanelVote(dealId, 0, VOTE_SUPPLIER);
    }

    // =========================================================================
    // T5: Panel deal cannot use resolve/resolveSplit
    // =========================================================================

    function testT5_Resolve_OnPanelDeal_Reverts() public {
        uint256 dealId = _createPanelDeal();
        _acceptAndFund(dealId);
        _dispute(dealId);

        vm.prank(p0);
        vm.expectRevert(IWaybillEscrow.NotSingleArbiter.selector);
        escrow.resolve(dealId, 0, true);
    }

    function testT5_ResolveSplit_OnPanelDeal_Reverts() public {
        uint256 dealId = _createPanelDeal();
        _acceptAndFund(dealId);
        _dispute(dealId);

        vm.prank(p0);
        vm.expectRevert(IWaybillEscrow.NotSingleArbiter.selector);
        escrow.resolveSplit(dealId, 0, 5_000);
    }

    // =========================================================================
    // T6: Non-panel member vote reverts
    // =========================================================================

    function testT6_NonPanelMember_Vote_Reverts() public {
        uint256 dealId = _createPanelDeal();
        _acceptAndFund(dealId);
        _dispute(dealId);

        address stranger = makeAddr("stranger");
        vm.prank(stranger);
        vm.expectRevert(IWaybillEscrow.NotPanelMember.selector);
        escrow.castPanelVote(dealId, 0, VOTE_SUPPLIER);
    }

    // =========================================================================
    // T7: Invalid vote encoding reverts
    // =========================================================================

    function testT7_InvalidVoteEncoding_Zero_Reverts() public {
        uint256 dealId = _createPanelDeal();
        _acceptAndFund(dealId);
        _dispute(dealId);
        vm.prank(p0);
        vm.expectRevert(IWaybillEscrow.InvalidVoteEncoding.selector);
        escrow.castPanelVote(dealId, 0, 0);
    }

    function testT7_InvalidVoteEncoding_Three_Reverts() public {
        uint256 dealId = _createPanelDeal();
        _acceptAndFund(dealId);
        _dispute(dealId);
        vm.prank(p0);
        vm.expectRevert(IWaybillEscrow.InvalidVoteEncoding.selector);
        escrow.castPanelVote(dealId, 0, 3);
    }

    function testT7_InvalidVoteEncoding_TooHigh_Reverts() public {
        uint256 dealId = _createPanelDeal();
        _acceptAndFund(dealId);
        _dispute(dealId);
        vm.prank(p0);
        vm.expectRevert(IWaybillEscrow.InvalidVoteEncoding.selector);
        escrow.castPanelVote(dealId, 0, 10_004);
    }

    // =========================================================================
    // T8: One vote leaves state/balances/currentLocked unchanged
    // =========================================================================

    function testT8_OneVote_NoMoneyMove() public {
        uint256 dealId = _createPanelDeal();
        _acceptAndFund(dealId);
        _dispute(dealId);

        uint256 lockedBefore    = escrow.currentLocked();
        uint256 supBefore       = usdc.balanceOf(supplierPay);
        uint256 buyBefore       = usdc.balanceOf(buyerRef);
        uint256 escrowBefore    = usdc.balanceOf(address(escrow));

        vm.prank(p0);
        escrow.castPanelVote(dealId, 0, VOTE_SUPPLIER);

        // No money should have moved
        assertEq(escrow.currentLocked(),              lockedBefore,  "T8: locked unchanged");
        assertEq(usdc.balanceOf(supplierPay),         supBefore,     "T8: supplier unchanged");
        assertEq(usdc.balanceOf(buyerRef),            buyBefore,     "T8: buyer unchanged");
        assertEq(usdc.balanceOf(address(escrow)),     escrowBefore,  "T8: escrow unchanged");

        // Vote is recorded
        assertEq(escrow.getPanelVote(dealId, 0, p0), VOTE_SUPPLIER, "T8: vote recorded");
        assertEq(escrow.getPanelVote(dealId, 0, p1), 0,             "T8: p1 not voted");

        // Milestone still DISPUTED
        IWaybillEscrow.Milestone memory ms = escrow.getMilestone(dealId, 0);
        assertEq(uint8(ms.state), uint8(IWaybillEscrow.MilestoneState.DISPUTED), "T8: still disputed");
    }

    // =========================================================================
    // T9: Duplicate vote reverts
    // =========================================================================

    function testT9_DuplicateVote_Reverts() public {
        uint256 dealId = _createPanelDeal();
        _acceptAndFund(dealId);
        _dispute(dealId);

        vm.prank(p0); escrow.castPanelVote(dealId, 0, VOTE_SUPPLIER);
        vm.prank(p0);
        vm.expectRevert(IWaybillEscrow.AlreadyVoted.selector);
        escrow.castPanelVote(dealId, 0, VOTE_SUPPLIER);
    }

    // =========================================================================
    // T10: Two matching votes — toSupplier — execute exactly once
    // =========================================================================

    function testT10_TwoMatchingVotes_Supplier_Executes() public {
        uint256 dealId = _createPanelDeal();
        _acceptAndFund(dealId);
        _dispute(dealId);

        uint256 fee         = escrow.getTrancheFee(dealId, 0);
        uint256 supBefore   = usdc.balanceOf(supplierPay);
        uint256 lockedBefore = escrow.currentLocked();

        vm.prank(p0); escrow.castPanelVote(dealId, 0, VOTE_SUPPLIER);
        // p0 voted, no execution yet
        IWaybillEscrow.Milestone memory ms0 = escrow.getMilestone(dealId, 0);
        assertEq(uint8(ms0.state), uint8(IWaybillEscrow.MilestoneState.DISPUTED), "T10: still disputed after 1");

        vm.prank(p1); escrow.castPanelVote(dealId, 0, VOTE_SUPPLIER);
        // Two matching votes => resolution executes
        IWaybillEscrow.Milestone memory ms1 = escrow.getMilestone(dealId, 0);
        assertEq(uint8(ms1.state), uint8(IWaybillEscrow.MilestoneState.RESOLVED), "T10: resolved after 2");

        // Supplier received tranche (BuyerPrepaid: supplier gets full tranche)
        assertEq(usdc.balanceOf(supplierPay) - supBefore, TOTAL, "T10: supplier got TOTAL");

        // currentLocked decreased by tranche + fee
        assertEq(lockedBefore - escrow.currentLocked(), TOTAL + fee, "T10: locked decreased by tranche+fee");

        // Deal settled
        IWaybillEscrow.Deal memory deal = escrow.getDeal(dealId);
        assertEq(uint8(deal.state), uint8(IWaybillEscrow.DealState.SETTLED), "T10: deal settled");
    }

    // =========================================================================
    // T11: Two matching votes — toBuyer — execute
    // =========================================================================

    function testT11_TwoMatchingVotes_Buyer_Executes() public {
        uint256 dealId = _createPanelDeal();
        _acceptAndFund(dealId);
        _dispute(dealId);

        uint256 fee        = escrow.getTrancheFee(dealId, 0);
        uint256 buyBefore  = usdc.balanceOf(buyerRef);
        uint256 lockedBefore = escrow.currentLocked();

        vm.prank(p0); escrow.castPanelVote(dealId, 0, VOTE_BUYER);
        vm.prank(p2); escrow.castPanelVote(dealId, 0, VOTE_BUYER);

        IWaybillEscrow.Milestone memory ms = escrow.getMilestone(dealId, 0);
        assertEq(uint8(ms.state), uint8(IWaybillEscrow.MilestoneState.RESOLVED), "T11: resolved");

        // BuyerPrepaid: buyer gets tranche + fee
        assertEq(usdc.balanceOf(buyerRef) - buyBefore, TOTAL + fee, "T11: buyer got TOTAL+fee");
        assertEq(lockedBefore - escrow.currentLocked(), TOTAL + fee, "T11: locked decreased");

        IWaybillEscrow.Deal memory deal = escrow.getDeal(dealId);
        assertEq(uint8(deal.state), uint8(IWaybillEscrow.DealState.SETTLED), "T11: deal settled");
    }

    // =========================================================================
    // T12: Two matching votes — partial split — exact payouts
    // =========================================================================

    function testT12_TwoMatchingVotes_Split_Executes() public {
        uint256 dealId = _createPanelDeal();
        _acceptAndFund(dealId);
        _dispute(dealId);

        uint256 fee          = escrow.getTrancheFee(dealId, 0);
        uint16  supplierBps  = 3_000; // 30% to supplier
        uint32  voteEncoded  = voteSplit(supplierBps);

        uint256 supBefore  = usdc.balanceOf(supplierPay);
        uint256 buyBefore  = usdc.balanceOf(buyerRef);
        uint256 lockedBefore = escrow.currentLocked();

        vm.prank(p1); escrow.castPanelVote(dealId, 0, voteEncoded);
        vm.prank(p2); escrow.castPanelVote(dealId, 0, voteEncoded);

        IWaybillEscrow.Milestone memory ms = escrow.getMilestone(dealId, 0);
        assertEq(uint8(ms.state), uint8(IWaybillEscrow.MilestoneState.RESOLVED), "T12: resolved");

        // BuyerPrepaid: bpf = fee; supplierDeducted = 0.
        // supplierOut = principal*30% - 0 = 300 USDC
        // buyerOut    = principal*70% + fee*(70%/100%) = 700 + fee*7000/10000
        uint256 principalSupplier = (TOTAL * supplierBps) / 10_000;
        uint256 principalBuyer    = TOTAL - principalSupplier;
        uint256 feeSupplier       = (fee * supplierBps) / 10_000;
        // supplierDeducted = 0 for BuyerPrepaid
        uint256 supplierOut  = principalSupplier;
        uint256 bpfBuyerShare = (fee * (10_000 - supplierBps)) / 10_000;
        uint256 buyerOut     = principalBuyer + bpfBuyerShare;

        assertEq(usdc.balanceOf(supplierPay) - supBefore, supplierOut, "T12: supplier payout");
        assertEq(usdc.balanceOf(buyerRef)    - buyBefore, buyerOut,    "T12: buyer payout");
        // currentLocked decrements by tranche + bpf (= fee for BuyerPrepaid)
        assertEq(lockedBefore - escrow.currentLocked(), TOTAL + fee,   "T12: locked decreased");
        // treasury gets feeSupplier
        assertEq(escrow.feeBalance(treasury), feeSupplier,             "T12: treasury fee");
    }

    // =========================================================================
    // T13: Disagreeing votes do not resolve; third vote breaks tie
    // =========================================================================

    function testT13_DisagreingVotes_ThenThirdMatches() public {
        uint256 dealId = _createPanelDeal();
        _acceptAndFund(dealId);
        _dispute(dealId);

        // p0 votes supplier, p1 votes buyer — no consensus
        vm.prank(p0); escrow.castPanelVote(dealId, 0, VOTE_SUPPLIER);
        vm.prank(p1); escrow.castPanelVote(dealId, 0, VOTE_BUYER);

        // Still disputed — no money moved
        IWaybillEscrow.Milestone memory ms0 = escrow.getMilestone(dealId, 0);
        assertEq(uint8(ms0.state), uint8(IWaybillEscrow.MilestoneState.DISPUTED), "T13: still disputed");

        // p2 votes supplier — 2-of-3 for supplier
        uint256 supBefore = usdc.balanceOf(supplierPay);
        vm.prank(p2); escrow.castPanelVote(dealId, 0, VOTE_SUPPLIER);

        IWaybillEscrow.Milestone memory ms1 = escrow.getMilestone(dealId, 0);
        assertEq(uint8(ms1.state), uint8(IWaybillEscrow.MilestoneState.RESOLVED), "T13: resolved by third");
        assertEq(usdc.balanceOf(supplierPay) - supBefore, TOTAL, "T13: supplier paid on resolution");
    }

    // =========================================================================
    // T14: Vote after resolution reverts
    // =========================================================================

    function testT14_VoteAfterResolution_Reverts() public {
        uint256 dealId = _createPanelDeal();
        _acceptAndFund(dealId);
        _dispute(dealId);

        vm.prank(p0); escrow.castPanelVote(dealId, 0, VOTE_SUPPLIER);
        vm.prank(p1); escrow.castPanelVote(dealId, 0, VOTE_SUPPLIER);
        // Deal is now resolved/settled

        // After settlement the deal state is SETTLED, so we get InvalidDealState
        // (the FUNDED guard fires before the milestone-state check).
        vm.prank(p2);
        vm.expectRevert(IWaybillEscrow.InvalidDealState.selector);
        escrow.castPanelVote(dealId, 0, VOTE_SUPPLIER);
    }

    // =========================================================================
    // T15: Vote after arbiter deadline reverts
    // =========================================================================

    function testT15_VoteAfterArbiterDeadline_Reverts() public {
        uint256 dealId = _createPanelDeal();
        _acceptAndFund(dealId);
        _dispute(dealId);

        // arbiterDeadline = disputeTime + responsePeriod + arbiterDeadlineHours
        // After _dispute we warped 73h past dispute. The arbiterDeadline = dispute + 72h(response) + 72h(arbiter) = dispute + 144h.
        // We already warped 73h, so warp another 144h+1 past the dispute time.
        vm.warp(block.timestamp + 72 hours + 1);

        vm.prank(p0);
        vm.expectRevert(IWaybillEscrow.ArbiterDeadlinePassed.selector);
        escrow.castPanelVote(dealId, 0, VOTE_SUPPLIER);
    }

    // =========================================================================
    // T16: Arbiter-fee credited once on panel resolution, refunded on default
    // =========================================================================

    function testT16_ArbiterFee_CreditedOnce_PanelResolution() public {
        // Create panel deal with arbiterFee
        address[] memory panel = new address[](3);
        panel[0] = p0; panel[1] = p1; panel[2] = p2;
        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](1);
        ms[0] = IWaybillEscrow.MilestoneInput({
            bps: 10_000, condition: IWaybillEscrow.ReleaseCondition.ACCEPTANCE,
            attestors: new address[](0), threshold: 0,
            deadline: 0, gracePeriod: 0, reviewWindow: 1, dependsOn: type(uint16).max
        });
        uint256 arbFee = 10e6; // 10 USDC arbiter fee
        vm.prank(buyer);
        uint256 dealId = escrow.createDealWithPanel(
            supplier, buyerRef, address(0), panel, TOTAL, FEE_BPS,
            uint64(block.timestamp + 7 days), 72, ms,
            false, arbFee, IWaybillEscrow.FeePayer.BuyerPrepaid
        );
        _acceptAndFund(dealId);
        _dispute(dealId);

        // Resolve via panel
        vm.prank(p0); escrow.castPanelVote(dealId, 0, VOTE_SUPPLIER);
        vm.prank(p1); escrow.castPanelVote(dealId, 0, VOTE_SUPPLIER);

        // Arbiter fee credited to deal.arbiter (= p0)
        assertEq(escrow.arbiterFeeBalance(p0), arbFee, "T16: arbiter fee credited to p0");
        // p0 withdraws
        uint256 p0Before = usdc.balanceOf(p0);
        vm.prank(p0); escrow.withdrawArbiterFee(dealId);
        assertEq(usdc.balanceOf(p0) - p0Before, arbFee, "T16: p0 received arbiter fee");
        assertEq(escrow.arbiterFeeBalance(p0),  0,      "T16: balance cleared");
    }

    function testT16b_ArbiterFee_RefundedOnDefault() public {
        // Create panel deal with arbiterFee
        address[] memory panel = new address[](3);
        panel[0] = p0; panel[1] = p1; panel[2] = p2;
        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](1);
        ms[0] = IWaybillEscrow.MilestoneInput({
            bps: 10_000, condition: IWaybillEscrow.ReleaseCondition.ACCEPTANCE,
            attestors: new address[](0), threshold: 0,
            deadline: 0, gracePeriod: 0, reviewWindow: 1, dependsOn: type(uint16).max
        });
        uint256 arbFee = 5e6;
        vm.prank(buyer);
        uint256 dealId = escrow.createDealWithPanel(
            supplier, buyerRef, address(0), panel, TOTAL, FEE_BPS,
            uint64(block.timestamp + 7 days), 72, ms,
            false, arbFee, IWaybillEscrow.FeePayer.BuyerPrepaid
        );
        _acceptAndFund(dealId);
        _dispute(dealId);

        // Warp PAST the arbiter deadline without any vote
        vm.warp(block.timestamp + 72 hours + 1); // now past arbiterDeadline

        uint256 buyBefore = usdc.balanceOf(buyerRef);
        escrow.applyDefault(dealId, 0);

        // Arbiter fee must be refunded to buyer
        assertGt(usdc.balanceOf(buyerRef), buyBefore, "T16b: buyer got refund including arbiter fee");
    }

    // =========================================================================
    // T17: Mixed single/panel deals — votes/liabilities do not cross-contaminate
    // =========================================================================

    function testT17_MixedDeals_NoCrossContamination() public {
        // Panel deal
        uint256 panelId = _createPanelDeal();
        _acceptAndFund(panelId);

        // Single-arbiter deal
        IWaybillEscrow.MilestoneInput[] memory ms2 = new IWaybillEscrow.MilestoneInput[](1);
        ms2[0] = IWaybillEscrow.MilestoneInput({
            bps: 10_000, condition: IWaybillEscrow.ReleaseCondition.ACCEPTANCE,
            attestors: new address[](0), threshold: 0,
            deadline: 0, gracePeriod: 0, reviewWindow: 1, dependsOn: type(uint16).max
        });
        vm.prank(buyer);
        uint256 singleId = escrow.createDeal(
            supplier, buyerRef, singleArbiter, TOTAL, FEE_BPS,
            uint64(block.timestamp + 7 days), 72, ms2
        );
        vm.prank(supplier); escrow.acceptSupplier(singleId, supplierPay);
        vm.prank(singleArbiter); escrow.acceptArbiter(singleId);
        vm.prank(buyer); escrow.fund(singleId);

        // Dispute both
        vm.prank(buyer); escrow.dispute(panelId, 0, keccak256("ev1"));
        vm.prank(buyer); escrow.dispute(singleId, 0, keccak256("ev2"));
        vm.warp(block.timestamp + 73 hours);

        // Panel votes for panelId
        vm.prank(p0); escrow.castPanelVote(panelId, 0, VOTE_SUPPLIER);
        vm.prank(p1); escrow.castPanelVote(panelId, 0, VOTE_SUPPLIER);

        // Panel deal is resolved; single deal is still disputed
        IWaybillEscrow.Milestone memory pm = escrow.getMilestone(panelId, 0);
        IWaybillEscrow.Milestone memory sm = escrow.getMilestone(singleId, 0);
        assertEq(uint8(pm.state), uint8(IWaybillEscrow.MilestoneState.RESOLVED), "T17: panel resolved");
        assertEq(uint8(sm.state), uint8(IWaybillEscrow.MilestoneState.DISPUTED), "T17: single still disputed");

        // Panel vote storage for single deal is zero
        assertEq(escrow.getPanelVote(singleId, 0, p0), 0, "T17: no panel vote on single deal");

        // Single arbiter resolves their own deal normally
        vm.prank(singleArbiter); escrow.resolve(singleId, 0, false);
        IWaybillEscrow.Milestone memory sm2 = escrow.getMilestone(singleId, 0);
        assertEq(uint8(sm2.state), uint8(IWaybillEscrow.MilestoneState.RESOLVED), "T17: single resolved");
    }

    // =========================================================================
    // T18: Response-window gate (vote before response window closes reverts)
    // =========================================================================

    function testT18_VoteDuringResponseWindow_Reverts() public {
        uint256 dealId = _createPanelDeal();
        _acceptAndFund(dealId);

        // Dispute but do NOT warp past response window
        vm.prank(buyer);
        escrow.dispute(dealId, 0, keccak256("ev"));
        // Response window = 72h; we are at dispute time + 0

        vm.prank(p0);
        vm.expectRevert(IWaybillEscrow.ResponseWindowOpen.selector);
        escrow.castPanelVote(dealId, 0, VOTE_SUPPLIER);
    }

    // =========================================================================
    // 31.7 Early resolve on panel deals
    // =========================================================================

    function testEarly_Panel_TwoOfThreeImmediatelyAfterResponse() public {
        uint256 dealId = _createPanelDeal();
        _acceptAndFund(dealId);
        vm.prank(buyer); escrow.dispute(dealId, 0, keccak256("ev"));
        vm.prank(supplier); escrow.respondToDispute(dealId, 0, keccak256("resp"));
        uint256 supBefore = usdc.balanceOf(supplierPay);
        vm.prank(p0); escrow.castPanelVote(dealId, 0, VOTE_SUPPLIER);
        vm.prank(p2); escrow.castPanelVote(dealId, 0, VOTE_SUPPLIER);
        assertEq(uint8(escrow.getMilestone(dealId, 0).state), uint8(IWaybillEscrow.MilestoneState.RESOLVED));
        assertEq(usdc.balanceOf(supplierPay) - supBefore, TOTAL);
    }

    function testEarly_Panel_SplitDisagreeThenMatch_AfterResponse() public {
        uint256 dealId = _createPanelDeal();
        _acceptAndFund(dealId);
        vm.prank(buyer); escrow.dispute(dealId, 0, keccak256("ev"));
        vm.prank(supplier); escrow.respondToDispute(dealId, 0, keccak256("resp"));
        vm.prank(p0); escrow.castPanelVote(dealId, 0, VOTE_BUYER);
        vm.prank(p1); escrow.castPanelVote(dealId, 0, voteSplit(6_000));
        assertEq(uint8(escrow.getMilestone(dealId, 0).state), uint8(IWaybillEscrow.MilestoneState.DISPUTED));
        vm.prank(p2); escrow.castPanelVote(dealId, 0, voteSplit(6_000));
        assertEq(uint8(escrow.getMilestone(dealId, 0).state), uint8(IWaybillEscrow.MilestoneState.RESOLVED));
    }

    function testEarly_Panel_RaiserResponseRejected_VoteStillBlocked() public {
        uint256 dealId = _createPanelDeal();
        _acceptAndFund(dealId);
        vm.prank(buyer); escrow.dispute(dealId, 0, keccak256("ev"));
        vm.prank(buyer);
        vm.expectRevert(IWaybillEscrow.NotDisputeResponder.selector);
        escrow.respondToDispute(dealId, 0, keccak256("self"));
        vm.prank(p0);
        vm.expectRevert(IWaybillEscrow.ResponseWindowOpen.selector);
        escrow.castPanelVote(dealId, 0, VOTE_BUYER);
    }

    function testEarly_Panel_NoResponse_After72h_Allowed() public {
        uint256 dealId = _createPanelDeal();
        _acceptAndFund(dealId);
        _dispute(dealId); // warps 73h, no response
        vm.prank(p1); escrow.castPanelVote(dealId, 0, VOTE_BUYER);
        vm.prank(p2); escrow.castPanelVote(dealId, 0, VOTE_BUYER);
        assertEq(uint8(escrow.getMilestone(dealId, 0).state), uint8(IWaybillEscrow.MilestoneState.RESOLVED));
    }

    function testEarly_Panel_VoteAfterReanchoredDeadline_Reverts() public {
        uint256 dealId = _createPanelDeal();
        _acceptAndFund(dealId);
        vm.prank(buyer); escrow.dispute(dealId, 0, keccak256("ev"));
        vm.prank(supplier); escrow.respondToDispute(dealId, 0, keccak256("resp"));
        vm.warp(uint256(escrow.getMilestone(dealId, 0).arbiterDeadline) + 1);
        vm.prank(p0);
        vm.expectRevert(IWaybillEscrow.ArbiterDeadlinePassed.selector);
        escrow.castPanelVote(dealId, 0, VOTE_BUYER);
        escrow.applyDefault(dealId, 0);
    }
}
