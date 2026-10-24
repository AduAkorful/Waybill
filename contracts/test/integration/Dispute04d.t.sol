// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {WaybillEscrow}    from "../../src/core/WaybillEscrow.sol";
import {IWaybillEscrow}   from "../../src/interfaces/IWaybillEscrow.sol";
import {ArbiterList}      from "../../src/registry/ArbiterList.sol";
import {AttestorRegistry} from "../../src/registry/AttestorRegistry.sol";

// ─────────────────────────────────────────────────────────────────────────────
// Minimal mock USDC (same as other test files)
// ─────────────────────────────────────────────────────────────────────────────
contract MockUSDC_04d {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => bool) public blocked;

    function setBlocked(address t, bool v) external { blocked[t] = v; }
    function mint(address to, uint256 amt) external { balanceOf[to] += amt; }
    function transfer(address to, uint256 amt) external returns (bool) {
        if (blocked[msg.sender] || blocked[to]) return false;
        require(balanceOf[msg.sender] >= amt, "insufficient");
        balanceOf[msg.sender] -= amt; balanceOf[to] += amt; return true;
    }
    function transferFrom(address from, address to, uint256 amt) external returns (bool) {
        require(balanceOf[from] >= amt, "insufficient");
        require(allowance[from][msg.sender] >= amt, "allowance");
        allowance[from][msg.sender] -= amt;
        balanceOf[from] -= amt; balanceOf[to] += amt; return true;
    }
    function approve(address sp, uint256 amt) external returns (bool) {
        allowance[msg.sender][sp] = amt; return true;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Dispute04d — 04d feature tests
//
// Covers:
//   1. arbiterDeadline = responseDeadline + arbiterDeadlineHours (clock test)
//   2. resolve blocked while response window open (ResponseWindowOpen)
//   3. resolve allowed after response window, before arbiterDeadline
//   4. resolve blocked after arbiterDeadline (ArbiterDeadlinePassed)
//   5. appendDisputeEvidence: ordered storage, count, event
//   6. appendDisputeEvidence rejections: empty hash, non-party, post-deadline, post-resolve
//   7. withdrawDispute: buyer restores CLAIMABLE, no money movement, currentLocked unchanged
//   8. withdrawDispute: supplier-raised dispute cannot be withdrawn by buyer
//   9. withdrawDispute: repeated call reverts (milestone not DISPUTED after first withdraw)
//  10. withdrawDispute: late (post-default) call reverts (milestone not DISPUTED)
//  11. withdrawDispute: buyer claims after withdraw
//  12. no fee or currentLocked changes from evidence appends or dispute withdrawal
// ─────────────────────────────────────────────────────────────────────────────
contract Dispute04d is Test {

    // ── addresses ─────────────────────────────────────────────────────────────
    address internal buyer       = address(0xB1);
    address internal supplier    = address(0xB2);
    address internal buyRef      = address(0xB3);
    address internal supPay      = address(0xB4);
    address internal arbiter     = address(0xAB);
    address internal treasury    = address(0xFE);
    address internal pauser      = address(0xDE);
    address internal stranger    = address(0x99);

    // ── contracts ─────────────────────────────────────────────────────────────
    MockUSDC_04d   internal usdc;
    WaybillEscrow  internal escrow;

    uint16  internal constant FEE_BPS        = 50;   // 0.5%
    uint256 internal constant TOTAL          = 100e6; // 100 USDC
    uint32  internal constant RESP_HOURS     = 72;    // responsePeriodHours (fixed in Deal)
    uint32  internal constant ARB_HOURS      = 48;    // arbiterDeadlineHours

    function setUp() public {
        usdc = new MockUSDC_04d();
        address[] memory arbs = new address[](1);
        arbs[0] = arbiter;
        ArbiterList list = new ArbiterList(pauser, arbs);
        AttestorRegistry reg  = new AttestorRegistry(pauser);
        escrow = new WaybillEscrow(
            address(usdc), treasury, pauser,
            10_000_000e6, 100_000_000e6,
            address(list), address(reg)
        );
        vm.prank(pauser); reg.addWriter(address(escrow));
        usdc.mint(buyer, 100_000e6);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────────────────

    /// Private key for attestor used in _setup_buyerDispute
    uint256 internal attPk;
    address internal attAddr;

    /// Create and fund a deal, put milestone 0 into DISPUTED (buyer raises from IN_REVIEW).
    /// Uses an ATTESTATION milestone with reviewWindow=24h so attest → IN_REVIEW → buyer disputes.
    /// Returns (dealId, disputeTime) where disputeTime == block.timestamp when dispute was raised.
    function _setup_buyerDispute() internal returns (uint256 dealId, uint64 disputeTime) {
        (attAddr, attPk) = makeAddrAndKey("attDisp04d");

        address[] memory atts = new address[](1);
        atts[0] = attAddr;

        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](1);
        ms[0] = IWaybillEscrow.MilestoneInput({
            bps:          10_000,
            condition:    IWaybillEscrow.ReleaseCondition.ATTESTATION,
            attestors:    atts,
            threshold:    1,
            deadline:     uint64(block.timestamp + 30 days),
            gracePeriod:  0,
            reviewWindow: 24, // 24h review window: attest → IN_REVIEW, buyer disputes from there
            dependsOn: type(uint16).max
        });

        uint256 fee = (TOTAL * FEE_BPS + 9_999) / 10_000;
        vm.startPrank(buyer);
        usdc.approve(address(escrow), TOTAL + fee);
        dealId = escrow.createDeal(
            supplier, buyRef, arbiter,
            TOTAL, FEE_BPS,
            uint64(block.timestamp + 7 days), ARB_HOURS, ms
        );
        vm.stopPrank();

        vm.prank(supplier); escrow.acceptSupplier(dealId, supPay);
        vm.prank(attAddr);  escrow.acceptAttestor(dealId, 0);
        vm.prank(arbiter);  escrow.acceptArbiter(dealId);
        vm.prank(buyer);    escrow.fund(dealId);

        // Sign and submit attestation to move to IN_REVIEW
        bytes32 evHash  = keccak256("attest-ev");
        uint64 signedAt = uint64(block.timestamp);
        uint64 expiry   = signedAt + 2 hours;
        bytes32 structHash = keccak256(abi.encode(
            escrow.ATTESTATION_TYPEHASH(),
            dealId, uint8(0),
            block.chainid, address(escrow), attAddr,
            escrow.STATEMENT_VERSION(), evHash, signedAt, expiry
        ));
        bytes32 digest = escrow.hashTypedDataV4(structHash);
        (uint8 v, bytes32 r, bytes32 s_) = vm.sign(attPk, digest);
        vm.prank(attAddr);
        escrow.attest(dealId, 0, evHash, signedAt, expiry, attAddr, abi.encodePacked(r, s_, v));
        // milestone 0 → IN_REVIEW

        vm.prank(buyer);
        escrow.dispute(dealId, 0, keccak256("buyer-evidence-1"));
        disputeTime = uint64(block.timestamp);
        // milestone 0 → DISPUTED, buyerRaisedDispute = true
    }

    /// Create and fund a deal, put milestone 0 into DISPUTED (supplier raises from OVERDUE).
    function _setup_supplierDispute() internal returns (uint256 dealId) {
        (address supAttAddr,) = makeAddrAndKey("attSupDisp04d");

        address[] memory atts = new address[](1);
        atts[0] = supAttAddr;

        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](1);
        ms[0] = IWaybillEscrow.MilestoneInput({
            bps:          10_000,
            condition:    IWaybillEscrow.ReleaseCondition.ATTESTATION,
            attestors:    atts,
            threshold:    1,
            deadline:     uint64(block.timestamp + 1 days),
            gracePeriod:  48,
            reviewWindow: 0,
            dependsOn: type(uint16).max
        });

        uint256 fee = (TOTAL * FEE_BPS + 9_999) / 10_000;
        vm.startPrank(buyer);
        usdc.approve(address(escrow), TOTAL + fee);
        dealId = escrow.createDeal(
            supplier, buyRef, arbiter,
            TOTAL, FEE_BPS,
            uint64(block.timestamp + 7 days), ARB_HOURS, ms
        );
        vm.stopPrank();

        vm.prank(supplier);   escrow.acceptSupplier(dealId, supPay);
        vm.prank(supAttAddr); escrow.acceptAttestor(dealId, 0);
        vm.prank(arbiter);    escrow.acceptArbiter(dealId);
        vm.prank(buyer);      escrow.fund(dealId);
        // ATTESTATION+reviewWindow=0 → WAITING after fund
        vm.warp(block.timestamp + 1 days + 1 hours);
        vm.prank(supplier);
        escrow.dispute(dealId, 0, keccak256("supplier-evidence-1"));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // T1: exact clock — responseDeadline and arbiterDeadline
    // ─────────────────────────────────────────────────────────────────────────
    function testClocks_responseDeadlineAndArbiterDeadline() public {
        (uint256 dealId, uint64 disputeTime) = _setup_buyerDispute();

        IWaybillEscrow.Milestone memory ms = escrow.getMilestone(dealId, 0);

        uint64 expectedResponse = disputeTime + uint64(RESP_HOURS) * 1 hours;
        uint64 expectedArbiter  = expectedResponse + uint64(ARB_HOURS) * 1 hours;

        assertEq(ms.responseDeadline, expectedResponse,
            "responseDeadline = disputeTime + responsePeriodHours");
        assertEq(ms.arbiterDeadline,  expectedArbiter,
            "arbiterDeadline = responseDeadline + arbiterDeadlineHours");

        // Sanity: arbiterDeadline > responseDeadline
        assertGt(ms.arbiterDeadline, ms.responseDeadline,
            "arbiterDeadline must be after responseDeadline");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // T2: resolve blocked while response window is open
    // ─────────────────────────────────────────────────────────────────────────
    function testResolve_blockedDuringResponseWindow() public {
        (uint256 dealId,) = _setup_buyerDispute();

        // 1 second into the dispute — well inside response window
        vm.warp(block.timestamp + 1);

        vm.prank(arbiter);
        vm.expectRevert(IWaybillEscrow.ResponseWindowOpen.selector);
        escrow.resolve(dealId, 0, true);

        vm.prank(arbiter);
        vm.expectRevert(IWaybillEscrow.ResponseWindowOpen.selector);
        escrow.resolveSplit(dealId, 0, 5_000);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // T3: resolve allowed after response window, before arbiterDeadline
    // ─────────────────────────────────────────────────────────────────────────
    function testResolve_allowedAfterResponseWindow() public {
        (uint256 dealId,) = _setup_buyerDispute();

        IWaybillEscrow.Milestone memory ms0 = escrow.getMilestone(dealId, 0);
        // Warp to 1 second after responseDeadline — inside arbiterDeadline
        vm.warp(uint256(ms0.responseDeadline) + 1);

        uint256 supBefore = usdc.balanceOf(supPay);
        vm.prank(arbiter);
        escrow.resolve(dealId, 0, true);

        assertGt(usdc.balanceOf(supPay) - supBefore, 0, "supplier received tranche");

        IWaybillEscrow.Deal memory deal = escrow.getDeal(dealId);
        assertEq(uint8(deal.state), uint8(IWaybillEscrow.DealState.SETTLED), "deal settled");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // T4: resolve blocked after arbiterDeadline
    // ─────────────────────────────────────────────────────────────────────────
    function testResolve_blockedAfterArbiterDeadline() public {
        (uint256 dealId,) = _setup_buyerDispute();

        IWaybillEscrow.Milestone memory ms0 = escrow.getMilestone(dealId, 0);
        vm.warp(uint256(ms0.arbiterDeadline) + 1);

        vm.prank(arbiter);
        vm.expectRevert(IWaybillEscrow.ArbiterDeadlinePassed.selector);
        escrow.resolve(dealId, 0, true);

        vm.prank(arbiter);
        vm.expectRevert(IWaybillEscrow.ArbiterDeadlinePassed.selector);
        escrow.resolveSplit(dealId, 0, 5_000);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // T5: appendDisputeEvidence — ordered storage, count, event
    // ─────────────────────────────────────────────────────────────────────────
    function testAppendEvidence_orderedStorageCountEvent() public {
        (uint256 dealId,) = _setup_buyerDispute();

        bytes32 e1 = keccak256("ev-1");
        bytes32 e2 = keccak256("ev-2");
        bytes32 e3 = keccak256("ev-3");

        assertEq(escrow.getDisputeEvidenceCount(dealId, 0), 0, "initial count 0");

        // buyer appends first
        vm.expectEmit(true, true, true, true);
        emit IWaybillEscrow.DisputeEvidenceAppended(dealId, 0, buyer, e1, 0);
        vm.prank(buyer);
        escrow.appendDisputeEvidence(dealId, 0, e1);
        assertEq(escrow.getDisputeEvidenceCount(dealId, 0), 1);

        // supplier appends second
        vm.expectEmit(true, true, true, true);
        emit IWaybillEscrow.DisputeEvidenceAppended(dealId, 0, supplier, e2, 1);
        vm.prank(supplier);
        escrow.appendDisputeEvidence(dealId, 0, e2);
        assertEq(escrow.getDisputeEvidenceCount(dealId, 0), 2);

        // buyer appends third
        vm.prank(buyer);
        escrow.appendDisputeEvidence(dealId, 0, e3);
        assertEq(escrow.getDisputeEvidenceCount(dealId, 0), 3);

        // Verify order
        bytes32[] memory all = escrow.getDisputeEvidence(dealId, 0);
        assertEq(all.length, 3);
        assertEq(all[0], e1, "index 0");
        assertEq(all[1], e2, "index 1");
        assertEq(all[2], e3, "index 2");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // T6: appendDisputeEvidence rejections
    // ─────────────────────────────────────────────────────────────────────────
    function testAppendEvidence_rejectsZeroHash() public {
        (uint256 dealId,) = _setup_buyerDispute();

        vm.prank(buyer);
        vm.expectRevert(IWaybillEscrow.EvidenceHashZero.selector);
        escrow.appendDisputeEvidence(dealId, 0, bytes32(0));
    }

    function testAppendEvidence_rejectsNonParty() public {
        (uint256 dealId,) = _setup_buyerDispute();

        vm.prank(stranger);
        vm.expectRevert(IWaybillEscrow.NotParticipant.selector);
        escrow.appendDisputeEvidence(dealId, 0, keccak256("stranger-ev"));

        vm.prank(arbiter);
        vm.expectRevert(IWaybillEscrow.NotParticipant.selector);
        escrow.appendDisputeEvidence(dealId, 0, keccak256("arbiter-ev"));
    }

    function testAppendEvidence_rejectsPostArbiterDeadline() public {
        (uint256 dealId,) = _setup_buyerDispute();

        IWaybillEscrow.Milestone memory ms0 = escrow.getMilestone(dealId, 0);
        vm.warp(uint256(ms0.arbiterDeadline) + 1);

        vm.prank(buyer);
        vm.expectRevert(IWaybillEscrow.ArbiterDeadlinePassed.selector);
        escrow.appendDisputeEvidence(dealId, 0, keccak256("late-ev"));
    }

    function testAppendEvidence_rejectsPostResolution() public {
        (uint256 dealId,) = _setup_buyerDispute();

        IWaybillEscrow.Milestone memory ms0 = escrow.getMilestone(dealId, 0);
        vm.warp(uint256(ms0.responseDeadline) + 1);

        vm.prank(arbiter);
        escrow.resolve(dealId, 0, true);

        // Milestone is RESOLVED and deal is SETTLED — state check fires before NotDisputed
        vm.prank(buyer);
        vm.expectRevert(IWaybillEscrow.InvalidDealState.selector);
        escrow.appendDisputeEvidence(dealId, 0, keccak256("post-resolve-ev"));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // T7: withdrawDispute — buyer restores CLAIMABLE, no money movement
    // ─────────────────────────────────────────────────────────────────────────
    function testWithdrawDispute_restoresCLAIMABLE_noMoneyMove() public {
        (uint256 dealId,) = _setup_buyerDispute();

        uint256 lockedBefore  = escrow.currentLocked();
        uint256 escrowBal     = usdc.balanceOf(address(escrow));
        uint256 buyerBal      = usdc.balanceOf(buyRef);
        uint256 supplierBal   = usdc.balanceOf(supPay);

        vm.expectEmit(true, true, false, true);
        emit IWaybillEscrow.DisputeWithdrawn(dealId, 0, buyer);
        vm.prank(buyer);
        escrow.withdrawDispute(dealId, 0);

        // Milestone restored to CLAIMABLE
        IWaybillEscrow.Milestone memory ms = escrow.getMilestone(dealId, 0);
        assertEq(uint8(ms.state), uint8(IWaybillEscrow.MilestoneState.CLAIMABLE),
            "milestone CLAIMABLE after withdraw");
        assertFalse(ms.disputed,           "disputed cleared");
        assertFalse(ms.buyerRaisedDispute, "buyerRaisedDispute cleared");
        assertEq(ms.responseDeadline,  0, "responseDeadline zeroed");
        assertEq(ms.arbiterDeadline,   0, "arbiterDeadline zeroed");

        // No money moved
        assertEq(escrow.currentLocked(),          lockedBefore,  "currentLocked unchanged");
        assertEq(usdc.balanceOf(address(escrow)), escrowBal,     "escrow balance unchanged");
        assertEq(usdc.balanceOf(buyRef),          buyerBal,      "buyer unchanged");
        assertEq(usdc.balanceOf(supPay),          supplierBal,   "supplier unchanged");

        // No fee ledger changes
        assertEq(escrow.feeBalance(treasury), 0, "treasury fee unchanged");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // T8: supplier-raised dispute cannot be withdrawn by buyer
    // ─────────────────────────────────────────────────────────────────────────
    function testWithdrawDispute_supplierRaisedReverts() public {
        uint256 dealId = _setup_supplierDispute();

        vm.prank(buyer);
        vm.expectRevert(IWaybillEscrow.NotBuyerRaisedDispute.selector);
        escrow.withdrawDispute(dealId, 0);

        // Milestone still DISPUTED
        IWaybillEscrow.Milestone memory ms = escrow.getMilestone(dealId, 0);
        assertEq(uint8(ms.state), uint8(IWaybillEscrow.MilestoneState.DISPUTED));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // T9: repeated withdrawDispute call reverts
    // ─────────────────────────────────────────────────────────────────────────
    function testWithdrawDispute_repeatedReverts() public {
        (uint256 dealId,) = _setup_buyerDispute();

        vm.prank(buyer);
        escrow.withdrawDispute(dealId, 0);

        // Second call — milestone is CLAIMABLE now, not DISPUTED
        vm.prank(buyer);
        vm.expectRevert(IWaybillEscrow.DisputeAlreadyWithdrawn.selector);
        escrow.withdrawDispute(dealId, 0);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // T10: withdrawDispute after applyDefault (milestone RESOLVED) reverts
    // ─────────────────────────────────────────────────────────────────────────
    function testWithdrawDispute_afterDefaultReverts() public {
        (uint256 dealId,) = _setup_buyerDispute();

        IWaybillEscrow.Milestone memory ms0 = escrow.getMilestone(dealId, 0);
        // Warp past arbiterDeadline so applyDefault can fire
        vm.warp(uint256(ms0.arbiterDeadline) + 1);

        escrow.applyDefault(dealId, 0);

        // Milestone is RESOLVED now, not DISPUTED
        vm.prank(buyer);
        vm.expectRevert(IWaybillEscrow.DisputeAlreadyWithdrawn.selector);
        escrow.withdrawDispute(dealId, 0);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // T11: buyer claims successfully after withdrawDispute
    // ─────────────────────────────────────────────────────────────────────────
    function testWithdrawDispute_thenClaimSucceeds() public {
        (uint256 dealId,) = _setup_buyerDispute();

        vm.prank(buyer);
        escrow.withdrawDispute(dealId, 0);

        // Milestone is CLAIMABLE — supplier can now claim
        // But wait: this is a BUYER_APPROVAL milestone; it was in IN_REVIEW,
        // buyer disputed, buyer withdrew. Now CLAIMABLE.
        // For BUYER_APPROVAL the buyer must approve it via approveMilestone.
        // After withdrawDispute the state is CLAIMABLE so supplier can claim directly.
        uint256 supBefore = usdc.balanceOf(supPay);
        uint256 fee       = escrow.getTrancheFee(dealId, 0);

        escrow.claim(dealId, 0);

        assertEq(usdc.balanceOf(supPay) - supBefore, TOTAL, "supplier received full tranche");
        // Milestone was ATTESTATION + attested → treasury gets 60%, attestor gets 40%.
        assertEq(escrow.feeBalance(treasury), fee * 60 / 100, "treasury received 60% of fee");

        IWaybillEscrow.Deal memory deal = escrow.getDeal(dealId);
        assertEq(uint8(deal.state), uint8(IWaybillEscrow.DealState.SETTLED), "deal settled");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // T12: wrong-party withdrawDispute reverts (only buyer may call)
    // ─────────────────────────────────────────────────────────────────────────
    function testWithdrawDispute_wrongPartyReverts() public {
        (uint256 dealId,) = _setup_buyerDispute();

        vm.prank(supplier);
        vm.expectRevert(IWaybillEscrow.NotBuyer.selector);
        escrow.withdrawDispute(dealId, 0);

        vm.prank(arbiter);
        vm.expectRevert(IWaybillEscrow.NotBuyer.selector);
        escrow.withdrawDispute(dealId, 0);

        vm.prank(stranger);
        vm.expectRevert(IWaybillEscrow.NotBuyer.selector);
        escrow.withdrawDispute(dealId, 0);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // T13: evidence appends do not change fees or currentLocked
    // ─────────────────────────────────────────────────────────────────────────
    function testAppendEvidence_noFeeOrLockedChange() public {
        (uint256 dealId,) = _setup_buyerDispute();

        uint256 lockedBefore   = escrow.currentLocked();
        uint256 escrowBalBefore = usdc.balanceOf(address(escrow));
        uint256 treasuryFee    = escrow.feeBalance(treasury);

        vm.prank(buyer);    escrow.appendDisputeEvidence(dealId, 0, keccak256("ev-a"));
        vm.prank(supplier); escrow.appendDisputeEvidence(dealId, 0, keccak256("ev-b"));
        vm.prank(buyer);    escrow.appendDisputeEvidence(dealId, 0, keccak256("ev-c"));

        assertEq(escrow.currentLocked(),          lockedBefore,    "locked unchanged");
        assertEq(usdc.balanceOf(address(escrow)), escrowBalBefore, "escrow balance unchanged");
        assertEq(escrow.feeBalance(treasury),     treasuryFee,     "treasury fee unchanged");
        assertEq(escrow.getDisputeEvidenceCount(dealId, 0), 3,     "count is 3");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // T14: withdrawDispute does not change fees or currentLocked
    // ─────────────────────────────────────────────────────────────────────────
    function testWithdrawDispute_noFeeOrLockedChange() public {
        (uint256 dealId,) = _setup_buyerDispute();

        uint256 lockedBefore    = escrow.currentLocked();
        uint256 escrowBalBefore = usdc.balanceOf(address(escrow));

        vm.prank(buyer);
        escrow.withdrawDispute(dealId, 0);

        assertEq(escrow.currentLocked(),          lockedBefore,    "locked unchanged");
        assertEq(usdc.balanceOf(address(escrow)), escrowBalBefore, "escrow balance unchanged");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // T15: resolve exactly at responseDeadline boundary (boundary test)
    //      block.timestamp == responseDeadline should still be blocked
    // ─────────────────────────────────────────────────────────────────────────
    function testResolve_atResponseDeadlineBoundary_stillBlocked() public {
        (uint256 dealId,) = _setup_buyerDispute();

        IWaybillEscrow.Milestone memory ms0 = escrow.getMilestone(dealId, 0);
        // Warp to exactly responseDeadline (not past it)
        vm.warp(ms0.responseDeadline);

        vm.prank(arbiter);
        vm.expectRevert(IWaybillEscrow.ResponseWindowOpen.selector);
        escrow.resolve(dealId, 0, true);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // T16: appendDisputeEvidence — both parties may submit during full window
    // ─────────────────────────────────────────────────────────────────────────
    function testAppendEvidence_bothPartiesMaySubmit() public {
        (uint256 dealId,) = _setup_buyerDispute();

        // Append during response window
        vm.prank(buyer);    escrow.appendDisputeEvidence(dealId, 0, keccak256("b1"));
        vm.prank(supplier); escrow.appendDisputeEvidence(dealId, 0, keccak256("s1"));

        IWaybillEscrow.Milestone memory ms0 = escrow.getMilestone(dealId, 0);
        // Advance past response window but inside arbiterDeadline
        vm.warp(uint256(ms0.responseDeadline) + 1);

        vm.prank(buyer);    escrow.appendDisputeEvidence(dealId, 0, keccak256("b2"));
        vm.prank(supplier); escrow.appendDisputeEvidence(dealId, 0, keccak256("s2"));

        assertEq(escrow.getDisputeEvidenceCount(dealId, 0), 4, "four entries total");

        bytes32[] memory all = escrow.getDisputeEvidence(dealId, 0);
        assertEq(all[0], keccak256("b1"));
        assertEq(all[1], keccak256("s1"));
        assertEq(all[2], keccak256("b2"));
        assertEq(all[3], keccak256("s2"));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 31.7 Early resolve: arbiter may decide as soon as the counterparty responds
    // ─────────────────────────────────────────────────────────────────────────

    function testEarly_resolveImmediatelyAfterResponse() public {
        (uint256 dealId,) = _setup_buyerDispute();
        vm.prank(supplier); escrow.respondToDispute(dealId, 0, keccak256("sup-resp"));
        uint256 supBefore = usdc.balanceOf(supPay);
        vm.prank(arbiter); escrow.resolve(dealId, 0, true);
        assertGt(usdc.balanceOf(supPay) - supBefore, 0, "supplier paid");
        assertEq(uint8(escrow.getDeal(dealId).state), uint8(IWaybillEscrow.DealState.SETTLED), "settled");
    }

    function testEarly_resolveSplitImmediatelyAfterResponse_supplierRaised() public {
        uint256 dealId = _setup_supplierDispute();
        vm.prank(buyer); escrow.respondToDispute(dealId, 0, keccak256("buy-resp"));
        vm.prank(arbiter); escrow.resolveSplit(dealId, 0, 4_000);
        assertEq(uint8(escrow.getMilestone(dealId, 0).state), uint8(IWaybillEscrow.MilestoneState.RESOLVED));
    }

    function testEarly_blockedWithoutResponseInsideWindow() public {
        (uint256 dealId,) = _setup_buyerDispute();
        vm.warp(escrow.getMilestone(dealId, 0).responseDeadline);
        vm.prank(arbiter);
        vm.expectRevert(IWaybillEscrow.ResponseWindowOpen.selector);
        escrow.resolve(dealId, 0, true);
    }

    function testEarly_allowedAfterWindowWithNoResponse() public {
        (uint256 dealId,) = _setup_buyerDispute();
        IWaybillEscrow.Milestone memory m = escrow.getMilestone(dealId, 0);
        assertFalse(m.responseSubmitted);
        vm.warp(uint256(m.responseDeadline) + 1);
        vm.prank(arbiter); escrow.resolve(dealId, 0, false);
        assertEq(uint8(escrow.getMilestone(dealId, 0).state), uint8(IWaybillEscrow.MilestoneState.RESOLVED));
    }

    function testEarly_raiserCannotRespondToUnlock() public {
        (uint256 dealId,) = _setup_buyerDispute();
        vm.prank(buyer);
        vm.expectRevert(IWaybillEscrow.NotDisputeResponder.selector);
        escrow.respondToDispute(dealId, 0, keccak256("self"));
        vm.prank(stranger);
        vm.expectRevert(IWaybillEscrow.NotParticipant.selector);
        escrow.respondToDispute(dealId, 0, keccak256("x"));
        vm.prank(arbiter);
        vm.expectRevert(IWaybillEscrow.ResponseWindowOpen.selector);
        escrow.resolve(dealId, 0, true);
    }

    function testEarly_arbiterDeadlineReanchoredOnResponse() public {
        (uint256 dealId,) = _setup_buyerDispute();
        vm.warp(block.timestamp + 10 hours);
        vm.prank(supplier); escrow.respondToDispute(dealId, 0, keccak256("r"));
        IWaybillEscrow.Milestone memory m = escrow.getMilestone(dealId, 0);
        assertEq(m.arbiterDeadline, uint64(block.timestamp) + uint64(ARB_HOURS) * 1 hours, "re-anchored");
        assertLt(m.arbiterDeadline, m.responseDeadline + uint64(ARB_HOURS) * 1 hours, "never extended");
        // default blocked until new deadline, then allowed; arbiter blocked after it
        vm.warp(m.arbiterDeadline);
        vm.expectRevert(IWaybillEscrow.ArbiterDeadlineActive.selector);
        escrow.applyDefault(dealId, 0);
        vm.warp(uint256(m.arbiterDeadline) + 1);
        vm.prank(arbiter);
        vm.expectRevert(IWaybillEscrow.ArbiterDeadlinePassed.selector);
        escrow.resolve(dealId, 0, true);
        escrow.applyDefault(dealId, 0);
        assertEq(uint8(escrow.getMilestone(dealId, 0).state), uint8(IWaybillEscrow.MilestoneState.RESOLVED));
    }

    function testEarly_noResponseDeadlineUnchanged_defaultPath() public {
        (uint256 dealId, uint64 t0) = _setup_buyerDispute();
        IWaybillEscrow.Milestone memory m = escrow.getMilestone(dealId, 0);
        assertEq(m.arbiterDeadline, t0 + uint64(RESP_HOURS + ARB_HOURS) * 1 hours);
        vm.warp(uint256(m.arbiterDeadline) + 1);
        escrow.applyDefault(dealId, 0);
    }

    function testEarly_withdrawThenRedispute_resetsResponse() public {
        (uint256 dealId,) = _setup_buyerDispute();
        vm.prank(supplier); escrow.respondToDispute(dealId, 0, keccak256("r"));
        vm.prank(buyer); escrow.withdrawDispute(dealId, 0);
        IWaybillEscrow.Milestone memory m = escrow.getMilestone(dealId, 0);
        assertFalse(m.responseSubmitted, "reset on withdraw");
        // after withdraw the milestone is no longer disputed; arbiter cannot act
        vm.prank(arbiter);
        vm.expectRevert(IWaybillEscrow.NotDisputed.selector);
        escrow.resolve(dealId, 0, true);
    }

    function testFuzz_Early_gateMatchesResponseOrWindow(uint32 dt, bool respond) public {
        (uint256 dealId,) = _setup_buyerDispute();
        IWaybillEscrow.Milestone memory m = escrow.getMilestone(dealId, 0);
        uint256 span = uint256(m.responseDeadline) - block.timestamp;
        dt = uint32(bound(dt, 0, span + 1 hours));
        if (respond) {
            vm.warp(block.timestamp + (dt > span ? span : dt));
            vm.prank(supplier); escrow.respondToDispute(dealId, 0, keccak256("r"));
        } else {
            vm.warp(block.timestamp + dt);
        }
        bool expectOk = respond || block.timestamp > m.responseDeadline;
        vm.prank(arbiter);
        if (!expectOk) vm.expectRevert(IWaybillEscrow.ResponseWindowOpen.selector);
        escrow.resolve(dealId, 0, true);
    }
}
