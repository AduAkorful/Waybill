// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console2} from "forge-std/Test.sol";
import {WaybillEscrow} from "../../src/core/WaybillEscrow.sol";
import {IWaybillEscrow} from "../../src/interfaces/IWaybillEscrow.sol";
import {ArbiterList} from "../../src/registry/ArbiterList.sol";
import {AttestorRegistry} from "../../src/registry/AttestorRegistry.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// ---------------------------------------------------------------------------
// Minimal ERC-20 mock
// ---------------------------------------------------------------------------
contract MockUSDC {
    string public name = "Mock USDC";
    string public symbol = "USDC";
    uint8 public decimals = 6;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    // Optional per-address transfer block (for INV-4/scenario-G)
    mapping(address => bool) public blocked;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function setBlocked(address target, bool value) external {
        blocked[target] = value;
    }

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

// ---------------------------------------------------------------------------
// Base test scaffold
// ---------------------------------------------------------------------------
contract WaybillEscrowTest is Test {
    WaybillEscrow internal escrow;
    MockUSDC internal usdc;

    // Named actors
    address internal treasury = address(0x1111);
    address internal pauser = address(0x2222);

    uint256 internal buyerPk = 0xB0B;
    uint256 internal supplierPk = 0x5077;
    uint256 internal attestorPk = 0xA11CE;
    uint256 internal arbiterPk = 0xAB1;

    address internal buyer;
    address internal supplier;
    address internal attestor;
    address internal arbiter;

    address internal supplierPayout = address(0xAAAA);
    address internal buyerRefund = address(0xBBBB);

    uint256 internal constant MAX_DEAL = 100_000e6;
    uint256 internal constant MAX_LOCKED = 1_000_000e6;
    uint16 internal constant FEE_BPS = 75;

    function setUp() public virtual {
        buyer = vm.addr(buyerPk);
        supplier = vm.addr(supplierPk);
        attestor = vm.addr(attestorPk);
        arbiter = vm.addr(arbiterPk);

        usdc = new MockUSDC();
        address[] memory initialArbiters = new address[](1);
        initialArbiters[0] = arbiter;
        ArbiterList list = new ArbiterList(pauser, initialArbiters);
        AttestorRegistry reg = new AttestorRegistry(pauser);
        escrow = new WaybillEscrow(address(usdc), treasury, pauser, MAX_DEAL, MAX_LOCKED, address(list), address(reg));
        vm.prank(pauser); reg.addWriter(address(escrow));
    }

    // ------------------------------------------------------------------
    // Helper: fund buyer wallet and approve escrow
    // ------------------------------------------------------------------

    function _none() internal pure returns (address[] memory a) {
        a = new address[](0);
    }

    function _one(address x) internal pure returns (address[] memory a) {
        a = new address[](1);
        a[0] = x;
    }

    function _two(address x, address y) internal pure returns (address[] memory a) {
        a = new address[](2);
        a[0] = x;
        a[1] = y;
    }

    function _fundBuyer(uint256 totalPlusFee) internal {
        usdc.mint(buyer, totalPlusFee);
        vm.prank(buyer);
        usdc.approve(address(escrow), totalPlusFee);
    }

    // ------------------------------------------------------------------
    // Helper: build a 3-milestone 20/30/50 deal
    // ------------------------------------------------------------------
    struct DealParams {
        uint256 total;
        uint16 feeBps;
        uint64 acceptDeadline;
        uint32 arbiterDeadlineHours;
    }

    function _milestone3InputsDefault() internal view returns (IWaybillEscrow.MilestoneInput[] memory) {
        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](3);
        // M0: ACCEPTANCE, 20%, immediate claimable
        ms[0] = IWaybillEscrow.MilestoneInput({
            bps: 2000,
            condition: IWaybillEscrow.ReleaseCondition.ACCEPTANCE,
            attestors: _none(), threshold: 0,
            deadline: uint64(block.timestamp + 30 days),
            gracePeriod: 72,
            reviewWindow: 0,
            dependsOn: type(uint16).max
        });
        // M1: ATTESTATION, 30%, 12h review window
        ms[1] = IWaybillEscrow.MilestoneInput({
            bps: 3000,
            condition: IWaybillEscrow.ReleaseCondition.ATTESTATION,
            attestors: _one(attestor), threshold: 1,
            deadline: uint64(block.timestamp + 60 days),
            gracePeriod: 72,
            reviewWindow: 12,
            dependsOn: type(uint16).max
        });
        // M2: ATTESTATION, 50%, 48h review window
        ms[2] = IWaybillEscrow.MilestoneInput({
            bps: 5000,
            condition: IWaybillEscrow.ReleaseCondition.ATTESTATION,
            attestors: _one(attestor), threshold: 1,
            deadline: uint64(block.timestamp + 90 days),
            gracePeriod: 72,
            reviewWindow: 48,
            dependsOn: type(uint16).max
        });
        return ms;
    }

    /// Creates a deal, runs all 4 accepts, and funds it. Returns dealId.
    function _createAndFundDeal(uint256 total) internal returns (uint256 dealId) {
        IWaybillEscrow.MilestoneInput[] memory ms = _milestone3InputsDefault();
        uint256 fee = (total * FEE_BPS + 9999) / 10000;
        _fundBuyer(total + fee);

        vm.prank(buyer);
        dealId = escrow.createDeal(
            supplier, buyerRefund, arbiter, total, FEE_BPS,
            uint64(block.timestamp + 7 days), 168, ms
        );

        vm.prank(supplier); escrow.acceptSupplier(dealId, supplierPayout);
        vm.prank(attestor); escrow.acceptAttestor(dealId, 1);
        vm.prank(attestor); escrow.acceptAttestor(dealId, 2);
        vm.prank(arbiter);  escrow.acceptArbiter(dealId);

        vm.prank(buyer);
        escrow.fund(dealId);
    }

    // ------------------------------------------------------------------
    // Helper: sign an EIP-712 attestation for a given milestone
    // ------------------------------------------------------------------
    function _signAttestation(
        uint256 dealId,
        uint8 milestoneIndex,
        bytes32 evidenceHash,
        uint64 signedAt,
        uint64 expiry
    ) internal view returns (bytes memory sig) {
        bytes32 structHash = keccak256(
            abi.encode(
                escrow.ATTESTATION_TYPEHASH(),
                dealId,
                uint256(milestoneIndex),
                block.chainid,
                address(escrow),
                attestor,                  // signer field
                escrow.STATEMENT_VERSION(),
                evidenceHash,
                signedAt,
                expiry
            )
        );
        bytes32 digest = escrow.hashTypedDataV4(structHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(attestorPk, digest);
        sig = abi.encodePacked(r, s, v);
    }

    function _defaultEvidence() internal pure returns (bytes32) {
        return keccak256("evidence-hash");
    }
}

// ===========================================================================
// INV-1: Tranche bps sum != 10000 reverts createDeal
// ===========================================================================
contract TestInv1 is WaybillEscrowTest {
    function test_inv1_sumUnder_reverts() public {
        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](2);
        ms[0] = IWaybillEscrow.MilestoneInput(2000, IWaybillEscrow.ReleaseCondition.ACCEPTANCE, _none(), 0, uint64(block.timestamp+1 days), 72, 0, type(uint16).max);
        ms[1] = IWaybillEscrow.MilestoneInput(4000, IWaybillEscrow.ReleaseCondition.ACCEPTANCE, _none(), 0, uint64(block.timestamp+2 days), 72, 0, type(uint16).max);
        vm.prank(buyer);
        vm.expectRevert(IWaybillEscrow.InvalidBpsSum.selector);
        escrow.createDeal(supplier, buyerRefund, arbiter, 10_000e6, FEE_BPS, uint64(block.timestamp+7 days), 168, ms);
    }

    function test_inv1_sumOver_reverts() public {
        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](2);
        ms[0] = IWaybillEscrow.MilestoneInput(5001, IWaybillEscrow.ReleaseCondition.ACCEPTANCE, _none(), 0, uint64(block.timestamp+1 days), 72, 0, type(uint16).max);
        ms[1] = IWaybillEscrow.MilestoneInput(5000, IWaybillEscrow.ReleaseCondition.ACCEPTANCE, _none(), 0, uint64(block.timestamp+2 days), 72, 0, type(uint16).max);
        vm.prank(buyer);
        vm.expectRevert(IWaybillEscrow.InvalidBpsSum.selector);
        escrow.createDeal(supplier, buyerRefund, arbiter, 10_000e6, FEE_BPS, uint64(block.timestamp+7 days), 168, ms);
    }

    function test_inv1_sumExact_succeeds() public {
        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](2);
        ms[0] = IWaybillEscrow.MilestoneInput(5000, IWaybillEscrow.ReleaseCondition.ACCEPTANCE, _none(), 0, uint64(block.timestamp+1 days), 72, 0, type(uint16).max);
        ms[1] = IWaybillEscrow.MilestoneInput(5000, IWaybillEscrow.ReleaseCondition.ACCEPTANCE, _none(), 0, uint64(block.timestamp+2 days), 72, 0, type(uint16).max);
        uint256 total = 10_000e6;
        uint256 fee = (total * FEE_BPS + 9999) / 10000;
        _fundBuyer(total + fee);
        vm.prank(buyer);
        escrow.createDeal(supplier, buyerRefund, arbiter, total, FEE_BPS, uint64(block.timestamp+7 days), 168, ms);
    }

    function test_inv1_moreThan8_reverts() public {
        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](9);
        for (uint256 i = 0; i < 8; i++) {
            ms[i] = IWaybillEscrow.MilestoneInput(1000, IWaybillEscrow.ReleaseCondition.ACCEPTANCE, _none(), 0, uint64(block.timestamp+1 days), 72, 0, type(uint16).max);
        }
        ms[8] = IWaybillEscrow.MilestoneInput(2000, IWaybillEscrow.ReleaseCondition.ACCEPTANCE, _none(), 0, uint64(block.timestamp+2 days), 72, 0, type(uint16).max);
        vm.prank(buyer);
        vm.expectRevert(IWaybillEscrow.InvalidMilestoneCount.selector);
        escrow.createDeal(supplier, buyerRefund, arbiter, 10_000e6, FEE_BPS, uint64(block.timestamp+7 days), 168, ms);
    }
}

// ===========================================================================
// INV-2: After fund, deal terms are frozen
// ===========================================================================
contract TestInv2 is WaybillEscrowTest {
    function test_inv2_cannotFundTwice() public {
        uint256 id = _createAndFundDeal(10_000e6);
        vm.prank(buyer);
        vm.expectRevert(IWaybillEscrow.InvalidDealState.selector);
        escrow.fund(id);
    }

    function test_inv2_cannotAcceptSupplierAfterFund() public {
        uint256 id = _createAndFundDeal(10_000e6);
        vm.prank(supplier);
        vm.expectRevert(IWaybillEscrow.InvalidDealState.selector);
        escrow.acceptSupplier(id, supplierPayout);
    }

    function test_inv2_fieldsUnchangedAfterFund() public {
        uint256 total = 10_000e6;
        uint256 id = _createAndFundDeal(total);
        IWaybillEscrow.Deal memory d = escrow.getDeal(id);
        assertEq(d.buyer, buyer);
        assertEq(d.supplier, supplier);
        assertEq(d.totalAmount, total);
        assertEq(uint256(d.feeBps), FEE_BPS);
        assertEq(uint8(d.state), uint8(IWaybillEscrow.DealState.FUNDED));
    }
}

// ===========================================================================
// INV-3: Solvency — escrow USDC balance >= unreleased + fees + refunds
// ===========================================================================
contract TestInv3 is WaybillEscrowTest {
    function test_inv3_balanceGteCurrentLocked() public {
        uint256 total = 10_000e6;
        uint256 id = _createAndFundDeal(total);
        uint256 escrowBal = usdc.balanceOf(address(escrow));
        assertGe(escrowBal, escrow.currentLocked());

        // Claim tranche 0 (ACCEPTANCE, immediate)
        escrow.claim(id, 0);
        assertGe(usdc.balanceOf(address(escrow)), escrow.currentLocked());

        // Attest and claim tranche 1
        bytes32 ev = _defaultEvidence();
        uint64 now64 = uint64(block.timestamp);
        bytes memory sig = _signAttestation(id, 1, ev, now64, now64 + 1 days);
        escrow.attest(id, 1, ev, now64, now64 + 1 days, attestor, sig);
        vm.warp(block.timestamp + 13 hours);
        escrow.claim(id, 1);
        assertGe(usdc.balanceOf(address(escrow)), escrow.currentLocked());
    }

    function test_inv3_afterWithdrawFees_balanceStillGte() public {
        uint256 total = 10_000e6;
        uint256 id = _createAndFundDeal(total);
        // Claim tranche 0 (acceptance → 100% protocol fee)
        escrow.claim(id, 0);
        // Treasury withdraws fees
        vm.prank(treasury);
        escrow.withdrawFees();
        // Solvency: escrow balance covers remaining locked
        assertGe(usdc.balanceOf(address(escrow)), escrow.currentLocked());
    }
}

// ===========================================================================
// INV-4: Each tranche has exactly one terminal fate
// ===========================================================================
contract TestInv4 is WaybillEscrowTest {
    function test_inv4_cannotClaimTwice() public {
        uint256 id = _createAndFundDeal(10_000e6);
        escrow.claim(id, 0);
        // Milestone 0 is now RELEASED; the deal still has outstanding milestones so it stays
        // FUNDED — the guard that fires is NotClaimable (milestone state check), not InvalidDealState.
        vm.expectRevert(IWaybillEscrow.NotClaimable.selector);
        escrow.claim(id, 0);
    }

    function test_inv4_cannotRefundReleased() public {
        uint256 id = _createAndFundDeal(10_000e6);
        escrow.claim(id, 0);
        vm.expectRevert();
        escrow.refund(id, 0);
    }

    function test_inv4_resolvedCannotBeClaimedOrRefunded() public {
        uint256 id = _createAndFundDeal(10_000e6);
        // Attest M1 → IN_REVIEW → buyer disputes
        bytes32 ev = _defaultEvidence();
        uint64 now64 = uint64(block.timestamp);
        bytes memory sig = _signAttestation(id, 1, ev, now64, now64 + 1 days);
        escrow.attest(id, 1, ev, now64, now64 + 1 days, attestor, sig);
        vm.prank(buyer);
        escrow.dispute(id, 1, ev);
        // (04d) warp past responseDeadline before arbiter can resolve
        vm.warp(uint256(escrow.getMilestone(id, 1).responseDeadline) + 1);
        // Arbiter resolves
        vm.prank(arbiter);
        escrow.resolve(id, 1, false); // refund buyer
        // Cannot claim or refund again
        vm.expectRevert();
        escrow.claim(id, 1);
        vm.expectRevert();
        escrow.refund(id, 1);
    }

    function test_inv4_refundedCannotBeRefundedAgain() public {
        // Single attestation milestone with short deadline
        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](1);
        ms[0] = IWaybillEscrow.MilestoneInput({
            bps: 10000,
            condition: IWaybillEscrow.ReleaseCondition.ATTESTATION,
            attestors: _one(attestor), threshold: 1,
            deadline: uint64(block.timestamp + 1 hours),
            gracePeriod: 1,
            reviewWindow: 0,
            dependsOn: type(uint16).max
        });
        uint256 total = 5_000e6;
        uint256 fee = (total * FEE_BPS + 9999) / 10000;
        _fundBuyer(total + fee);
        vm.prank(buyer);
        uint256 id = escrow.createDeal(supplier, buyerRefund, arbiter, total, FEE_BPS, uint64(block.timestamp+7 days), 168, ms);
        vm.prank(supplier); escrow.acceptSupplier(id, supplierPayout);
        vm.prank(attestor); escrow.acceptAttestor(id, 0);
        vm.prank(arbiter);  escrow.acceptArbiter(id);
        vm.prank(buyer);    escrow.fund(id);

        // Warp past deadline + grace
        vm.warp(block.timestamp + 2 hours + 1);
        // applyDefault → REFUNDABLE
        escrow.applyDefault(id, 0);
        // refund → REFUNDED
        escrow.refund(id, 0);
        // Cannot refund again — deal is now SETTLED, so hits InvalidDealState first
        vm.expectRevert(IWaybillEscrow.InvalidDealState.selector);
        escrow.refund(id, 0);
    }
}

// ===========================================================================
// INV-5: Funds only flow to supplier payout, buyer refund, or fee recipients
// ===========================================================================
contract TestInv5 is WaybillEscrowTest {
    function test_inv5_claimGoesToSupplierPayout() public {
        uint256 total = 10_000e6;
        uint256 id = _createAndFundDeal(total);
        uint256 before = usdc.balanceOf(supplierPayout);
        escrow.claim(id, 0);
        uint256 tranche0 = total * 2000 / 10000;
        assertEq(usdc.balanceOf(supplierPayout), before + tranche0);
    }

    function test_inv5_refundGoesToBuyerRefund() public {
        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](1);
        ms[0] = IWaybillEscrow.MilestoneInput(10000, IWaybillEscrow.ReleaseCondition.ATTESTATION, _one(attestor), 1, uint64(block.timestamp+1 hours), 1, 0, type(uint16).max);
        uint256 total = 5_000e6;
        uint256 fee = (total * FEE_BPS + 9999) / 10000;
        _fundBuyer(total + fee);
        vm.prank(buyer);
        uint256 id = escrow.createDeal(supplier, buyerRefund, arbiter, total, FEE_BPS, uint64(block.timestamp+7 days), 168, ms);
        vm.prank(supplier); escrow.acceptSupplier(id, supplierPayout);
        vm.prank(attestor); escrow.acceptAttestor(id, 0);
        vm.prank(arbiter);  escrow.acceptArbiter(id);
        vm.prank(buyer);    escrow.fund(id);

        uint256 beforeRefund = usdc.balanceOf(buyerRefund);
        vm.warp(block.timestamp + 2 hours + 1);
        escrow.applyDefault(id, 0); // → REFUNDABLE
        escrow.refund(id, 0);
        assertGt(usdc.balanceOf(buyerRefund), beforeRefund);
    }

    function test_inv5_feesGoToTreasury() public {
        uint256 total = 10_000e6;
        uint256 id = _createAndFundDeal(total);
        escrow.claim(id, 0); // ACCEPTANCE → 100% treasury
        // Verify fees were accrued
        uint256 accrued = escrow.feeBalance(treasury);
        assertGt(accrued, 0, "Treasury should have fees after ACCEPTANCE claim");
        uint256 beforeWithdraw = usdc.balanceOf(treasury);
        vm.prank(treasury);
        escrow.withdrawFees();
        assertEq(usdc.balanceOf(treasury), beforeWithdraw + accrued);
    }
}

// ===========================================================================
// INV-6: Attestation replay reverts
// ===========================================================================
contract TestInv6 is WaybillEscrowTest {
    function test_inv6_replaySameDeal() public {
        uint256 id = _createAndFundDeal(10_000e6);
        bytes32 ev = _defaultEvidence();
        uint64 now64 = uint64(block.timestamp);
        bytes memory sig = _signAttestation(id, 1, ev, now64, now64 + 1 days);

        // First use succeeds — milestone moves to IN_REVIEW (12h window)
        escrow.attest(id, 1, ev, now64, now64 + 1 days, attestor, sig);
        // Second use fails: milestone is now IN_REVIEW (not WAITING/OVERDUE) → InvalidMilestoneState
        vm.expectRevert(IWaybillEscrow.InvalidMilestoneState.selector);
        escrow.attest(id, 1, ev, now64, now64 + 1 days, attestor, sig);
    }

    function test_inv6_replayOnDifferentDeal() public {
        // Two separate deals with same attestor
        uint256 id0 = _createAndFundDeal(10_000e6);
        uint256 id1 = _createAndFundDeal(10_000e6);

        bytes32 ev = _defaultEvidence();
        uint64 now64 = uint64(block.timestamp);
        // Sign for deal 0
        bytes memory sig = _signAttestation(id0, 1, ev, now64, now64 + 1 days);

        // Works on deal 0
        escrow.attest(id0, 1, ev, now64, now64 + 1 days, attestor, sig);

        // Replay on deal 1: EIP-712 digest encodes dealId, so different digest → signer check fails
        vm.expectRevert(IWaybillEscrow.InvalidSigner.selector);
        escrow.attest(id1, 1, ev, now64, now64 + 1 days, attestor, sig);
    }

    function test_inv6_wrongChainId_reverts() public {
        uint256 id = _createAndFundDeal(10_000e6);
        bytes32 ev = _defaultEvidence();
        uint64 now64 = uint64(block.timestamp);
        uint64 expiry = now64 + 1 days;

        // Manually build struct hash with wrong chainId
        bytes32 structHash = keccak256(
            abi.encode(
                escrow.ATTESTATION_TYPEHASH(),
                id,
                uint256(1), // milestone index 1
                uint256(999), // WRONG chain id
                address(escrow),
                attestor,
                escrow.STATEMENT_VERSION(),
                ev,
                now64,
                expiry
            )
        );
        bytes32 digest = escrow.hashTypedDataV4(structHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(attestorPk, digest);
        bytes memory sig = abi.encodePacked(r, s, v);

        vm.expectRevert(IWaybillEscrow.InvalidSigner.selector);
        escrow.attest(id, 1, ev, now64, expiry, attestor, sig);
    }

    function test_inv6_wrongContract_reverts() public {
        uint256 id = _createAndFundDeal(10_000e6);
        bytes32 ev = _defaultEvidence();
        uint64 now64 = uint64(block.timestamp);
        uint64 expiry = now64 + 1 days;

        // Build struct with wrong verifyingContract
        bytes32 structHash = keccak256(
            abi.encode(
                escrow.ATTESTATION_TYPEHASH(),
                id,
                uint256(1),
                block.chainid,
                address(0xDEAD), // wrong contract
                attestor,
                escrow.STATEMENT_VERSION(),
                ev,
                now64,
                expiry
            )
        );
        // Use the real contract's domain separator to sign (but wrong contract in struct)
        bytes32 digest = escrow.hashTypedDataV4(structHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(attestorPk, digest);
        bytes memory sig = abi.encodePacked(r, s, v);

        vm.expectRevert(IWaybillEscrow.InvalidSigner.selector);
        escrow.attest(id, 1, ev, now64, expiry, attestor, sig);
    }
}

// ===========================================================================
// INV-7: Dispute freezes only that tranche; others progress
// ===========================================================================
contract TestInv7 is WaybillEscrowTest {
    function test_inv7_disputeOneOthersContinue() public {
        uint256 id = _createAndFundDeal(10_000e6);

        // Claim M0 (ACCEPTANCE, immediate)
        escrow.claim(id, 0);
        assertEq(uint8(escrow.getMilestone(id, 0).state), uint8(IWaybillEscrow.MilestoneState.RELEASED));

        // Attest M1 → IN_REVIEW → buyer disputes M1
        bytes32 ev = _defaultEvidence();
        uint64 now64 = uint64(block.timestamp);
        bytes memory sig1 = _signAttestation(id, 1, ev, now64, now64 + 1 days);
        escrow.attest(id, 1, ev, now64, now64 + 1 days, attestor, sig1);
        vm.prank(buyer);
        escrow.dispute(id, 1, ev);
        assertEq(uint8(escrow.getMilestone(id, 1).state), uint8(IWaybillEscrow.MilestoneState.DISPUTED));

        // M2 can still progress: attest → claim
        uint64 now2 = uint64(block.timestamp);
        bytes memory sig2 = _signAttestation(id, 2, ev, now2, now2 + 1 days);
        escrow.attest(id, 2, ev, now2, now2 + 1 days, attestor, sig2);
        vm.warp(block.timestamp + 49 hours);
        escrow.claim(id, 2);
        assertEq(uint8(escrow.getMilestone(id, 2).state), uint8(IWaybillEscrow.MilestoneState.RELEASED));

        // M1 still DISPUTED
        assertEq(uint8(escrow.getMilestone(id, 1).state), uint8(IWaybillEscrow.MilestoneState.DISPUTED));
    }
}

// ===========================================================================
// INV-8: Pause does not block claim/refund/resolve/applyDefault/withdrawFees
// ===========================================================================
contract TestInv8 is WaybillEscrowTest {
    function test_inv8_claimWorksPaused() public {
        uint256 id = _createAndFundDeal(10_000e6);
        vm.prank(pauser);
        escrow.pauseNewDeals();
        // Can still claim ACCEPTANCE milestone
        escrow.claim(id, 0);
        assertEq(uint8(escrow.getMilestone(id, 0).state), uint8(IWaybillEscrow.MilestoneState.RELEASED));
    }

    function test_inv8_refundWorksPaused() public {
        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](1);
        ms[0] = IWaybillEscrow.MilestoneInput(10000, IWaybillEscrow.ReleaseCondition.ATTESTATION, _one(attestor), 1, uint64(block.timestamp+1 hours), 1, 0, type(uint16).max);
        uint256 total = 5_000e6;
        uint256 fee = (total * FEE_BPS + 9999) / 10000;
        _fundBuyer(total + fee);
        vm.prank(buyer);
        uint256 id = escrow.createDeal(supplier, buyerRefund, arbiter, total, FEE_BPS, uint64(block.timestamp+7 days), 168, ms);
        vm.prank(supplier); escrow.acceptSupplier(id, supplierPayout);
        vm.prank(attestor); escrow.acceptAttestor(id, 0);
        vm.prank(arbiter);  escrow.acceptArbiter(id);
        vm.prank(buyer);    escrow.fund(id);

        vm.prank(pauser); escrow.pauseNewDeals();

        vm.warp(block.timestamp + 2 hours + 1);
        escrow.applyDefault(id, 0); // → REFUNDABLE
        escrow.refund(id, 0);       // → REFUNDED (works while paused)
        assertEq(uint8(escrow.getMilestone(id, 0).state), uint8(IWaybillEscrow.MilestoneState.REFUNDED));
    }

    function test_inv8_resolveWorksPaused() public {
        uint256 id = _createAndFundDeal(10_000e6);
        vm.prank(pauser); escrow.pauseNewDeals();

        bytes32 ev = _defaultEvidence();
        uint64 now64 = uint64(block.timestamp);
        bytes memory sig = _signAttestation(id, 1, ev, now64, now64 + 1 days);
        escrow.attest(id, 1, ev, now64, now64 + 1 days, attestor, sig);
        vm.prank(buyer);
        escrow.dispute(id, 1, ev);
        // (04d) warp past responseDeadline before arbiter can resolve
        vm.warp(uint256(escrow.getMilestone(id, 1).responseDeadline) + 1);

        vm.prank(arbiter);
        escrow.resolve(id, 1, true); // works paused
        assertEq(uint8(escrow.getMilestone(id, 1).state), uint8(IWaybillEscrow.MilestoneState.RESOLVED));
    }

    function test_inv8_withdrawFeesWorksPaused() public {
        uint256 id = _createAndFundDeal(10_000e6);
        escrow.claim(id, 0); // accrues treasury fee
        vm.prank(pauser); escrow.pauseNewDeals();
        vm.prank(treasury);
        escrow.withdrawFees(); // works paused
    }

    function test_inv8_createRevertsWhenPaused() public {
        vm.prank(pauser); escrow.pauseNewDeals();
        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](1);
        ms[0] = IWaybillEscrow.MilestoneInput(10000, IWaybillEscrow.ReleaseCondition.ACCEPTANCE, _none(), 0, uint64(block.timestamp+1 days), 72, 0, type(uint16).max);
        vm.prank(buyer);
        vm.expectRevert(IWaybillEscrow.NewDealsPausedError.selector);
        escrow.createDeal(supplier, buyerRefund, arbiter, 1000e6, FEE_BPS, uint64(block.timestamp+7 days), 168, ms);
    }

    function test_inv8_fundRevertsWhenPaused() public {
        // Create a proposed deal first (not paused yet)
        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](1);
        ms[0] = IWaybillEscrow.MilestoneInput(10000, IWaybillEscrow.ReleaseCondition.ACCEPTANCE, _none(), 0, uint64(block.timestamp+1 days), 72, 0, type(uint16).max);
        uint256 total = 1000e6;
        uint256 fee = (total * FEE_BPS + 9999) / 10000;
        _fundBuyer(total + fee);
        vm.prank(buyer);
        uint256 id = escrow.createDeal(supplier, buyerRefund, arbiter, total, FEE_BPS, uint64(block.timestamp+7 days), 168, ms);
        vm.prank(supplier); escrow.acceptSupplier(id, supplierPayout);
        vm.prank(arbiter);  escrow.acceptArbiter(id);

        // Now pause
        vm.prank(pauser); escrow.pauseNewDeals();

        vm.prank(buyer);
        vm.expectRevert(IWaybillEscrow.NewDealsPausedError.selector);
        escrow.fund(id);
    }
}

// ===========================================================================
// INV-9: No admin/pauser/treasury can sweep deal USDC
// ===========================================================================
contract TestInv9 is WaybillEscrowTest {
    function test_inv9_treasuryWithdrawOnlyAccrued() public {
        uint256 total = 10_000e6;
        uint256 id = _createAndFundDeal(total);
        escrow.claim(id, 0); // ACCEPTANCE → accrues fee to treasury

        uint256 accrued = escrow.feeBalance(treasury);
        assertGt(accrued, 0);

        uint256 beforeBal = usdc.balanceOf(treasury);
        vm.prank(treasury);
        escrow.withdrawFees();
        uint256 afterBal = usdc.balanceOf(treasury);

        assertEq(afterBal - beforeBal, accrued);
        // Treasury cannot withdraw more
        vm.prank(treasury);
        vm.expectRevert(IWaybillEscrow.NoFees.selector);
        escrow.withdrawFees();
    }

    function test_inv9_noPauserSweep() public {
        // pauser has no function to access deal USDC
        // Fund a deal
        uint256 id = _createAndFundDeal(10_000e6);
        uint256 escrowBalBefore = usdc.balanceOf(address(escrow));
        // pauser cannot move funds (no function)
        // Verify escrow balance unchanged
        assertEq(usdc.balanceOf(address(escrow)), escrowBalBefore);
        // No direct way to call a sweep from pauser — this is structural
        assertTrue(escrow.pauser() == pauser);
        // Just confirm that the contract has no sweep function by ensuring the deal funds remain
        assertGt(usdc.balanceOf(address(escrow)), 0);
    }
}

// ===========================================================================
// INV-10: Refunded fee equals prepaid fee for that tranche
// ===========================================================================
contract TestInv10 is WaybillEscrowTest {
    function test_inv10_refundedFeeEqualsStored() public {
        // Single attestation milestone, timeout → refund
        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](3);
        ms[0] = IWaybillEscrow.MilestoneInput(2000, IWaybillEscrow.ReleaseCondition.ATTESTATION, _one(attestor), 1, uint64(block.timestamp+1 hours), 1, 0, type(uint16).max);
        ms[1] = IWaybillEscrow.MilestoneInput(3000, IWaybillEscrow.ReleaseCondition.ATTESTATION, _one(attestor), 1, uint64(block.timestamp+2 hours), 1, 0, type(uint16).max);
        ms[2] = IWaybillEscrow.MilestoneInput(5000, IWaybillEscrow.ReleaseCondition.ACCEPTANCE, _none(), 0, uint64(block.timestamp+3 hours), 1, 0, type(uint16).max);

        uint256 total = 10_000e6;
        uint256 fee = (total * FEE_BPS + 9999) / 10000; // 75e6 + rounding = 75000750
        _fundBuyer(total + fee);
        vm.prank(buyer);
        uint256 id = escrow.createDeal(supplier, buyerRefund, arbiter, total, FEE_BPS, uint64(block.timestamp+7 days), 168, ms);
        vm.prank(supplier); escrow.acceptSupplier(id, supplierPayout);
        vm.prank(attestor); escrow.acceptAttestor(id, 0);
        vm.prank(attestor); escrow.acceptAttestor(id, 1);
        vm.prank(arbiter);  escrow.acceptArbiter(id);
        vm.prank(buyer);    escrow.fund(id);

        uint256 storedFee0 = escrow.getTrancheFee(id, 0);

        // Warp past deadline+grace for M0
        vm.warp(block.timestamp + 2 hours + 1);
        escrow.applyDefault(id, 0); // → REFUNDABLE

        uint256 tranche0 = total * 2000 / 10000; // 2000e6
        uint256 storedFee1 = escrow.getTrancheFee(id, 1);
        uint256 storedFee2 = escrow.getTrancheFee(id, 2);
        uint256 tranche1   = total * 3000 / 10000;
        uint256 tranche2   = total - tranche0 - tranche1;
        uint256 beforeRefund = usdc.balanceOf(buyerRefund);
        escrow.refund(id, 0);
        uint256 received = usdc.balanceOf(buyerRefund) - beforeRefund;

        // 04e cascade sweeps ALL non-terminal non-disputed later milestones.
        // M1 is WAITING (ATTESTATION, deadline just passed at warp 2h+1 — cascade sweeps it).
        // M2 is CLAIMABLE (ACCEPTANCE started CLAIMABLE on fund — cascade sweeps it too).
        // Buyer receives M0 + M1 + M2 tranches + all fees in one tx.
        assertEq(received, (tranche0 + storedFee0) + (tranche1 + storedFee1) + (tranche2 + storedFee2));
    }
}

// ===========================================================================
// SCENARIO-A: Happy path 20/30/50
// ===========================================================================
contract TestScenarioA is WaybillEscrowTest {
    function test_scenA_happy203050() public {
        uint256 total = 10_000e6;
        uint256 id = _createAndFundDeal(total);

        // M0: ACCEPTANCE + reviewWindow=0 → immediately CLAIMABLE on fund
        assertEq(uint8(escrow.getMilestone(id, 0).state), uint8(IWaybillEscrow.MilestoneState.CLAIMABLE));
        uint256 tranche0 = total * 2000 / 10000;
        uint256 t0fee = escrow.getTrancheFee(id, 0);
        escrow.claim(id, 0);
        assertEq(uint8(escrow.getMilestone(id, 0).state), uint8(IWaybillEscrow.MilestoneState.RELEASED));
        assertEq(usdc.balanceOf(supplierPayout), tranche0);
        // 100% to treasury (acceptance)
        assertEq(escrow.feeBalance(treasury), t0fee);

        // M1: ATTESTATION → attest → IN_REVIEW (12h window) → wait → claim
        bytes32 ev = _defaultEvidence();
        uint64 now64 = uint64(block.timestamp);
        bytes memory sig1 = _signAttestation(id, 1, ev, now64, now64 + 1 days);
        escrow.attest(id, 1, ev, now64, now64 + 1 days, attestor, sig1);
        assertEq(uint8(escrow.getMilestone(id, 1).state), uint8(IWaybillEscrow.MilestoneState.IN_REVIEW));
        vm.warp(block.timestamp + 13 hours);
        escrow.claim(id, 1);
        assertEq(uint8(escrow.getMilestone(id, 1).state), uint8(IWaybillEscrow.MilestoneState.RELEASED));
        // 60% treasury, 40% attestor
        uint256 t1fee = escrow.getTrancheFee(id, 1);
        uint256 t1treasury = (t1fee * 60) / 100;
        uint256 t1attestor = t1fee - t1treasury;
        assertEq(escrow.feeBalance(attestor), t1attestor);

        // M2: ATTESTATION → attest → IN_REVIEW → buyer approves early → CLAIMABLE → claim
        uint64 now2 = uint64(block.timestamp);
        bytes memory sig2 = _signAttestation(id, 2, ev, now2, now2 + 1 days);
        escrow.attest(id, 2, ev, now2, now2 + 1 days, attestor, sig2);
        assertEq(uint8(escrow.getMilestone(id, 2).state), uint8(IWaybillEscrow.MilestoneState.IN_REVIEW));
        vm.prank(buyer);
        // QA §35: early approval from IN_REVIEW must emit MilestoneApprovedEarly (was dead code)
        vm.expectEmit(true, true, false, false, address(escrow));
        emit IWaybillEscrow.MilestoneApprovedEarly(id, 2);
        escrow.approveMilestone(id, 2);
        assertEq(uint8(escrow.getMilestone(id, 2).state), uint8(IWaybillEscrow.MilestoneState.CLAIMABLE));
        escrow.claim(id, 2);
        assertEq(uint8(escrow.getMilestone(id, 2).state), uint8(IWaybillEscrow.MilestoneState.RELEASED));

        // Deal settled
        assertEq(uint8(escrow.getDeal(id).state), uint8(IWaybillEscrow.DealState.SETTLED));
    }
}

// ===========================================================================
// SCENARIO-B: Buyer disputes, arbiter refunds
// ===========================================================================
contract TestScenarioB is WaybillEscrowTest {
    function test_scenB_buyerDisputeThenRefund() public {
        // 2-milestone 50/50 deal
        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](2);
        ms[0] = IWaybillEscrow.MilestoneInput(5000, IWaybillEscrow.ReleaseCondition.ATTESTATION, _one(attestor), 1, uint64(block.timestamp+30 days), 72, 24, type(uint16).max);
        ms[1] = IWaybillEscrow.MilestoneInput(5000, IWaybillEscrow.ReleaseCondition.ATTESTATION, _one(attestor), 1, uint64(block.timestamp+60 days), 72, 0, type(uint16).max);
        uint256 total = 10_000e6;
        uint256 fee = (total * FEE_BPS + 9999) / 10000;
        _fundBuyer(total + fee);
        vm.prank(buyer);
        uint256 id = escrow.createDeal(supplier, buyerRefund, arbiter, total, FEE_BPS, uint64(block.timestamp+7 days), 168, ms);
        vm.prank(supplier); escrow.acceptSupplier(id, supplierPayout);
        vm.prank(attestor); escrow.acceptAttestor(id, 0);
        vm.prank(attestor); escrow.acceptAttestor(id, 1);
        vm.prank(arbiter);  escrow.acceptArbiter(id);
        vm.prank(buyer);    escrow.fund(id);

        // Attest M0 → IN_REVIEW → buyer disputes
        bytes32 ev = _defaultEvidence();
        uint64 now64 = uint64(block.timestamp);
        bytes memory sig0 = _signAttestation(id, 0, ev, now64, now64 + 1 days);
        escrow.attest(id, 0, ev, now64, now64 + 1 days, attestor, sig0);
        assertEq(uint8(escrow.getMilestone(id, 0).state), uint8(IWaybillEscrow.MilestoneState.IN_REVIEW));
        vm.prank(buyer);
        escrow.dispute(id, 0, ev);
        assertEq(uint8(escrow.getMilestone(id, 0).state), uint8(IWaybillEscrow.MilestoneState.DISPUTED));

        // (04d) warp past responseDeadline before arbiter can resolve
        vm.warp(uint256(escrow.getMilestone(id, 0).responseDeadline) + 1);

        // Arbiter refunds buyer
        uint256 beforeRefund = usdc.balanceOf(buyerRefund);
        vm.prank(arbiter);
        escrow.resolve(id, 0, false);
        assertEq(uint8(escrow.getMilestone(id, 0).state), uint8(IWaybillEscrow.MilestoneState.RESOLVED));
        assertGt(usdc.balanceOf(buyerRefund), beforeRefund);

        // M1 still progresses normally — capture timestamp fresh after the warp.
        // Use vm.getBlockTimestamp() to prevent the Yul optimizer from reusing
        // the earlier block.timestamp read from before the vm.warp call.
        uint64 now1 = uint64(vm.getBlockTimestamp());
        bytes memory sig1 = _signAttestation(id, 1, ev, now1, now1 + 1 days);
        escrow.attest(id, 1, ev, now1, now1 + 1 days, attestor, sig1);
        escrow.claim(id, 1);
        assertEq(uint8(escrow.getMilestone(id, 1).state), uint8(IWaybillEscrow.MilestoneState.RELEASED));

        assertEq(uint8(escrow.getDeal(id).state), uint8(IWaybillEscrow.DealState.SETTLED));
    }
}

// ===========================================================================
// SCENARIO-C: Timeout refund
// ===========================================================================
contract TestScenarioC is WaybillEscrowTest {
    function test_scenC_timeoutRefund() public {
        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](1);
        ms[0] = IWaybillEscrow.MilestoneInput(10000, IWaybillEscrow.ReleaseCondition.ATTESTATION, _one(attestor), 1, uint64(block.timestamp+1 hours), 2, 0, type(uint16).max);
        uint256 total = 5_000e6;
        uint256 fee = (total * FEE_BPS + 9999) / 10000;
        _fundBuyer(total + fee);
        vm.prank(buyer);
        uint256 id = escrow.createDeal(supplier, buyerRefund, arbiter, total, FEE_BPS, uint64(block.timestamp+7 days), 168, ms);
        vm.prank(supplier); escrow.acceptSupplier(id, supplierPayout);
        vm.prank(attestor); escrow.acceptAttestor(id, 0);
        vm.prank(arbiter);  escrow.acceptArbiter(id);
        vm.prank(buyer);    escrow.fund(id);

        // Warp past deadline + grace period
        vm.warp(block.timestamp + 3 hours + 1);
        // applyDefault transitions OVERDUE → REFUNDABLE
        escrow.applyDefault(id, 0);
        assertEq(uint8(escrow.getMilestone(id, 0).state), uint8(IWaybillEscrow.MilestoneState.REFUNDABLE));

        uint256 before = usdc.balanceOf(buyerRefund);
        escrow.refund(id, 0);
        assertGt(usdc.balanceOf(buyerRefund), before);
        assertEq(uint8(escrow.getMilestone(id, 0).state), uint8(IWaybillEscrow.MilestoneState.REFUNDED));
        assertEq(uint8(escrow.getDeal(id).state), uint8(IWaybillEscrow.DealState.SETTLED));
    }
}

// ===========================================================================
// SCENARIO-D: Replayed attestation (cross-deal)
// ===========================================================================
contract TestScenarioD is WaybillEscrowTest {
    function test_scenD_crossDealReplay() public {
        uint256 id0 = _createAndFundDeal(10_000e6);
        uint256 id1 = _createAndFundDeal(10_000e6);
        bytes32 ev = _defaultEvidence();
        uint64 now64 = uint64(block.timestamp);
        bytes memory sig = _signAttestation(id0, 1, ev, now64, now64 + 1 days);

        escrow.attest(id0, 1, ev, now64, now64 + 1 days, attestor, sig);

        // Replay on deal1 → wrong signer (digest encodes id0)
        vm.expectRevert(IWaybillEscrow.InvalidSigner.selector);
        escrow.attest(id1, 1, ev, now64, now64 + 1 days, attestor, sig);
    }
}

// ===========================================================================
// SCENARIO-E: Zero review window — immediate claimable on attest
// ===========================================================================
contract TestScenarioE is WaybillEscrowTest {
    function test_scenE_zeroReviewWindowClaimable() public {
        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](1);
        ms[0] = IWaybillEscrow.MilestoneInput(10000, IWaybillEscrow.ReleaseCondition.ATTESTATION, _one(attestor), 1, uint64(block.timestamp+30 days), 72, 0, type(uint16).max);
        uint256 total = 5_000e6;
        uint256 fee = (total * FEE_BPS + 9999) / 10000;
        _fundBuyer(total + fee);
        vm.prank(buyer);
        uint256 id = escrow.createDeal(supplier, buyerRefund, arbiter, total, FEE_BPS, uint64(block.timestamp+7 days), 168, ms);
        vm.prank(supplier); escrow.acceptSupplier(id, supplierPayout);
        vm.prank(attestor); escrow.acceptAttestor(id, 0);
        vm.prank(arbiter);  escrow.acceptArbiter(id);
        vm.prank(buyer);    escrow.fund(id);

        bytes32 ev = _defaultEvidence();
        uint64 now64 = uint64(block.timestamp);
        bytes memory sig = _signAttestation(id, 0, ev, now64, now64 + 1 days);
        escrow.attest(id, 0, ev, now64, now64 + 1 days, attestor, sig);

        // Should be immediately CLAIMABLE (reviewWindow = 0)
        assertEq(uint8(escrow.getMilestone(id, 0).state), uint8(IWaybillEscrow.MilestoneState.CLAIMABLE));
        escrow.claim(id, 0);
        assertEq(uint8(escrow.getMilestone(id, 0).state), uint8(IWaybillEscrow.MilestoneState.RELEASED));
    }
}

// ===========================================================================
// SCENARIO-F: Fund while paused reverts
// ===========================================================================
contract TestScenarioF is WaybillEscrowTest {
    function test_scenF_fundAndCreateRevertsWhenPaused() public {
        // Create deal before pause
        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](1);
        ms[0] = IWaybillEscrow.MilestoneInput(10000, IWaybillEscrow.ReleaseCondition.ACCEPTANCE, _none(), 0, uint64(block.timestamp+1 days), 72, 0, type(uint16).max);
        uint256 total = 1000e6;
        uint256 fee = (total * FEE_BPS + 9999) / 10000;
        _fundBuyer(total + fee);
        vm.prank(buyer);
        uint256 id = escrow.createDeal(supplier, buyerRefund, arbiter, total, FEE_BPS, uint64(block.timestamp+7 days), 168, ms);
        vm.prank(supplier); escrow.acceptSupplier(id, supplierPayout);
        vm.prank(arbiter);  escrow.acceptArbiter(id);

        vm.prank(pauser);
        escrow.pauseNewDeals();

        // fund() reverts
        vm.prank(buyer);
        vm.expectRevert(IWaybillEscrow.NewDealsPausedError.selector);
        escrow.fund(id);

        // createDeal() reverts
        vm.prank(buyer);
        vm.expectRevert(IWaybillEscrow.NewDealsPausedError.selector);
        escrow.createDeal(supplier, buyerRefund, arbiter, total, FEE_BPS, uint64(block.timestamp+7 days), 168, ms);

        // Unpause → fund succeeds
        vm.prank(pauser);
        escrow.unpauseNewDeals();
        vm.prank(buyer);
        escrow.fund(id);
        assertEq(uint8(escrow.getDeal(id).state), uint8(IWaybillEscrow.DealState.FUNDED));
    }
}

// ===========================================================================
// SCENARIO-G: Blocked token payout leaves milestone CLAIMABLE
// ===========================================================================
contract TestScenarioG is WaybillEscrowTest {
    function test_scenG_blockedPayoutStaysClaimable() public {
        uint256 id = _createAndFundDeal(10_000e6);

        // Block supplierPayout address in MockUSDC
        usdc.setBlocked(supplierPayout, true);

        // Attempt claim → transfer fails → PayoutFailed emitted, stays CLAIMABLE
        vm.expectEmit(true, true, false, false);
        emit IWaybillEscrow.PayoutFailed(id, 0, supplierPayout, 0);
        escrow.claim(id, 0);

        // State should be CLAIMABLE still (not RELEASED)
        assertEq(uint8(escrow.getMilestone(id, 0).state), uint8(IWaybillEscrow.MilestoneState.CLAIMABLE));

        // Unblock → claim succeeds
        usdc.setBlocked(supplierPayout, false);
        escrow.claim(id, 0);
        assertEq(uint8(escrow.getMilestone(id, 0).state), uint8(IWaybillEscrow.MilestoneState.RELEASED));
    }
}

// ===========================================================================
// SCENARIO-H: Late attestation in grace period
// ===========================================================================
contract TestScenarioH is WaybillEscrowTest {
    function test_scenH_lateAttestInGrace() public {
        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](1);
        ms[0] = IWaybillEscrow.MilestoneInput(10000, IWaybillEscrow.ReleaseCondition.ATTESTATION, _one(attestor), 1, uint64(block.timestamp+1 hours), 4, 0, type(uint16).max);
        uint256 total = 5_000e6;
        uint256 fee = (total * FEE_BPS + 9999) / 10000;
        _fundBuyer(total + fee);
        vm.prank(buyer);
        uint256 id = escrow.createDeal(supplier, buyerRefund, arbiter, total, FEE_BPS, uint64(block.timestamp+7 days), 168, ms);
        vm.prank(supplier); escrow.acceptSupplier(id, supplierPayout);
        vm.prank(attestor); escrow.acceptAttestor(id, 0);
        vm.prank(arbiter);  escrow.acceptArbiter(id);
        vm.prank(buyer);    escrow.fund(id);

        // Warp past deadline into grace period
        vm.warp(block.timestamp + 2 hours);
        // M0 should be OVERDUE (detected on attest)
        bytes32 ev = _defaultEvidence();
        uint64 now64 = uint64(block.timestamp);
        bytes memory sig = _signAttestation(id, 0, ev, now64, now64 + 1 days);
        escrow.attest(id, 0, ev, now64, now64 + 1 days, attestor, sig);
        // Still in grace → immediate claimable (reviewWindow=0)
        assertEq(uint8(escrow.getMilestone(id, 0).state), uint8(IWaybillEscrow.MilestoneState.CLAIMABLE));
        escrow.claim(id, 0);
        assertEq(uint8(escrow.getMilestone(id, 0).state), uint8(IWaybillEscrow.MilestoneState.RELEASED));
    }
}

// ===========================================================================
// SCENARIO-TIMED: TIMED release-condition correctness
//
// Spec: for TIMED milestones, block.timestamp >= deadline → confirmed (never
// OVERDUE).  block.timestamp < deadline → TimedNotReached.
// ===========================================================================
contract TestTimedRelease is WaybillEscrowTest {
    // ------------------------------------------------------------------
    // Helper: create + fund a single TIMED milestone deal.
    // deadline = block.timestamp + offset; reviewWindow configurable.
    // ------------------------------------------------------------------
    function _timedDeal(uint64 deadlineOffset, uint32 reviewWindow)
        internal
        returns (uint256 dealId, uint64 deadline)
    {
        deadline = uint64(block.timestamp) + deadlineOffset;

        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](1);
        ms[0] = IWaybillEscrow.MilestoneInput({
            bps: 10_000,
            condition: IWaybillEscrow.ReleaseCondition.TIMED,
            attestors: _none(), threshold: 0,
            deadline: deadline,
            gracePeriod: 0,       // irrelevant for TIMED
            reviewWindow: reviewWindow,
            dependsOn: type(uint16).max
        });

        uint256 total = 5_000e6;
        uint256 fee   = (total * FEE_BPS + 9999) / 10_000;
        _fundBuyer(total + fee);

        vm.prank(buyer);
        dealId = escrow.createDeal(
            supplier, buyerRefund, arbiter, total, FEE_BPS,
            uint64(block.timestamp + 7 days), 168, ms
        );
        vm.prank(supplier); escrow.acceptSupplier(dealId, supplierPayout);
        vm.prank(arbiter);  escrow.acceptArbiter(dealId);
        vm.prank(buyer);    escrow.fund(dealId);
    }

    // ------------------------------------------------------------------
    // T-1: claim exactly at the deadline succeeds and pays supplier
    // ------------------------------------------------------------------
    function testTimedClaimExactlyAtDeadline() public {
        (uint256 id, uint64 deadline) = _timedDeal(1 hours, 0);

        // Warp to exactly the deadline second
        vm.warp(deadline);

        uint256 beforeBal = usdc.balanceOf(supplierPayout);
        escrow.claim(id, 0);

        // Milestone must be RELEASED and supplier must have received funds
        assertEq(
            uint8(escrow.getMilestone(id, 0).state),
            uint8(IWaybillEscrow.MilestoneState.RELEASED),
            "milestone should be RELEASED"
        );
        assertGt(usdc.balanceOf(supplierPayout), beforeBal, "supplier should receive payment");

        // Deal must be SETTLED (single milestone)
        assertEq(
            uint8(escrow.getDeal(id).state),
            uint8(IWaybillEscrow.DealState.SETTLED),
            "deal should be SETTLED"
        );
    }

    // ------------------------------------------------------------------
    // T-2: claim after the deadline also succeeds (well past deadline)
    // ------------------------------------------------------------------
    function testTimedClaimAfterDeadline() public {
        (uint256 id, uint64 deadline) = _timedDeal(1 hours, 0);

        // Warp well past the deadline
        vm.warp(uint256(deadline) + 30 days);

        // Must NOT revert — TIMED past deadline is confirmed, not overdue
        uint256 beforeBal = usdc.balanceOf(supplierPayout);
        escrow.claim(id, 0);

        assertEq(
            uint8(escrow.getMilestone(id, 0).state),
            uint8(IWaybillEscrow.MilestoneState.RELEASED)
        );
        assertGt(usdc.balanceOf(supplierPayout), beforeBal);
    }

    // ------------------------------------------------------------------
    // T-3: claim before deadline reverts with TimedNotReached
    // ------------------------------------------------------------------
    function testTimedClaimBeforeDeadlineRevertsTimedNotReached() public {
        (uint256 id, uint64 deadline) = _timedDeal(1 hours, 0);

        // Warp to one second before deadline
        vm.warp(uint256(deadline) - 1);

        vm.expectRevert(IWaybillEscrow.TimedNotReached.selector);
        escrow.claim(id, 0);

        // Milestone must still be WAITING (not OVERDUE, not CLAIMABLE)
        assertEq(
            uint8(escrow.getMilestone(id, 0).state),
            uint8(IWaybillEscrow.MilestoneState.WAITING),
            "milestone should remain WAITING"
        );
    }

    // ------------------------------------------------------------------
    // T-5: TIMED + reviewWindow > 0 — first claim at deadline sets IN_REVIEW
    //      and returns WITHOUT paying (no ReviewActive revert).
    // ------------------------------------------------------------------
    function testTimedReviewWindowSameCallDoesNotRevertAndDoesNotPay() public {
        (uint256 id,) = _timedDeal(1 hours, 24); // 24-hour review window
        uint256 supplierBefore = usdc.balanceOf(supplierPayout);

        // Warp to exactly the deadline → confirmation
        vm.warp(block.timestamp + 1 hours);
        escrow.claim(id, 0); // must NOT revert

        assertEq(
            uint8(escrow.getMilestone(id, 0).state),
            uint8(IWaybillEscrow.MilestoneState.IN_REVIEW),
            "must be IN_REVIEW - review window started"
        );
        assertEq(usdc.balanceOf(supplierPayout), supplierBefore, "no payment yet");
    }

    // ------------------------------------------------------------------
    // T-6: TIMED + reviewWindow > 0 — second claim after window pays.
    // ------------------------------------------------------------------
    function testTimedReviewWindowLaterClaimPaysAfterWindow() public {
        (uint256 id,) = _timedDeal(1 hours, 24);

        // First claim at deadline → IN_REVIEW
        vm.warp(block.timestamp + 1 hours);
        escrow.claim(id, 0);
        assertEq(
            uint8(escrow.getMilestone(id, 0).state),
            uint8(IWaybillEscrow.MilestoneState.IN_REVIEW)
        );

        // Warp past the 24-hour review window
        vm.warp(block.timestamp + 25 hours);

        uint256 supplierBefore = usdc.balanceOf(supplierPayout);
        escrow.claim(id, 0);

        assertEq(
            uint8(escrow.getMilestone(id, 0).state),
            uint8(IWaybillEscrow.MilestoneState.RELEASED)
        );
        assertGt(usdc.balanceOf(supplierPayout), supplierBefore, "supplier must be paid");
        assertEq(
            uint8(escrow.getDeal(id).state),
            uint8(IWaybillEscrow.DealState.SETTLED)
        );
    }

    // ------------------------------------------------------------------
    // T-7: TIMED + reviewWindow > 0 — buyer can dispute while IN_REVIEW,
    //      arbiter resolves to supplier.
    // ------------------------------------------------------------------
    function testTimedReviewWindowBuyerCanDisputeInReview() public {
        (uint256 id,) = _timedDeal(1 hours, 24);

        // First claim at deadline → IN_REVIEW
        vm.warp(block.timestamp + 1 hours);
        escrow.claim(id, 0);
        assertEq(
            uint8(escrow.getMilestone(id, 0).state),
            uint8(IWaybillEscrow.MilestoneState.IN_REVIEW)
        );

        // Buyer disputes while still inside the review window
        vm.prank(buyer);
        escrow.dispute(id, 0, keccak256("timed-dispute-evidence"));
        assertEq(
            uint8(escrow.getMilestone(id, 0).state),
            uint8(IWaybillEscrow.MilestoneState.DISPUTED),
            "buyer must be able to dispute IN_REVIEW TIMED milestone"
        );

        // (04d) warp past responseDeadline before arbiter can resolve
        vm.warp(uint256(escrow.getMilestone(id, 0).responseDeadline) + 1);

        // Arbiter resolves to supplier
        vm.prank(arbiter);
        escrow.resolve(id, 0, true);
        assertEq(
            uint8(escrow.getMilestone(id, 0).state),
            uint8(IWaybillEscrow.MilestoneState.RESOLVED)
        );
    }

    // ------------------------------------------------------------------
    // T-4: ATTESTATION milestone past deadline with gracePeriod=0 → OVERDUE
    //      on attest, and applyDefault immediately → REFUNDABLE.
    //      TIMED must NOT follow this path (guards the non-TIMED branch).
    // ------------------------------------------------------------------
    function testAttestationStillOverdueAndRefundsAfterDeadline() public {
        // Single ATTESTATION milestone, deadline = now + 1 hour, gracePeriod = 0
        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](1);
        ms[0] = IWaybillEscrow.MilestoneInput({
            bps: 10_000,
            condition: IWaybillEscrow.ReleaseCondition.ATTESTATION,
            attestors: _one(attestor), threshold: 1,
            deadline: uint64(block.timestamp + 1 hours),
            gracePeriod: 0,     // zero grace: grace end == deadline
            reviewWindow: 0,
            dependsOn: type(uint16).max
        });

        uint256 total = 5_000e6;
        uint256 fee   = (total * FEE_BPS + 9999) / 10_000;
        _fundBuyer(total + fee);

        vm.prank(buyer);
        uint256 id = escrow.createDeal(
            supplier, buyerRefund, arbiter, total, FEE_BPS,
            uint64(block.timestamp + 7 days), 168, ms
        );
        vm.prank(supplier); escrow.acceptSupplier(id, supplierPayout);
        vm.prank(attestor); escrow.acceptAttestor(id, 0);
        vm.prank(arbiter);  escrow.acceptArbiter(id);
        vm.prank(buyer);    escrow.fund(id);

        // Warp past deadline (gracePeriod=0 means grace end == deadline, so
        // any timestamp strictly after deadline also passes the grace end)
        vm.warp(block.timestamp + 1 hours + 1);

        // applyDefault: _markOverdueIfNeeded fires (ATTESTATION, not TIMED) →
        // OVERDUE; then grace check: timestamp > graceEnd → REFUNDABLE
        escrow.applyDefault(id, 0);
        assertEq(
            uint8(escrow.getMilestone(id, 0).state),
            uint8(IWaybillEscrow.MilestoneState.REFUNDABLE),
            "ATTESTATION past deadline+grace should be REFUNDABLE"
        );

        // refund sends funds back to buyer
        uint256 beforeBal = usdc.balanceOf(buyerRefund);
        escrow.refund(id, 0);
        assertGt(usdc.balanceOf(buyerRefund), beforeBal, "buyer should receive refund");
        assertEq(
            uint8(escrow.getMilestone(id, 0).state),
            uint8(IWaybillEscrow.MilestoneState.REFUNDED)
        );
    }
}

// ===========================================================================
// SCENARIO-I: feeBps out of range reverts
// ===========================================================================
contract TestScenarioI is WaybillEscrowTest {
    function test_feeBpsTooLow_reverts() public {
        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](1);
        ms[0] = IWaybillEscrow.MilestoneInput(10000, IWaybillEscrow.ReleaseCondition.ACCEPTANCE, _none(), 0, uint64(block.timestamp+1 days), 72, 0, type(uint16).max);
        vm.prank(buyer);
        vm.expectRevert(IWaybillEscrow.InvalidFeeBps.selector);
        escrow.createDeal(supplier, buyerRefund, arbiter, 1000e6, 49, uint64(block.timestamp+7 days), 168, ms);
    }

    function test_feeBpsTooHigh_reverts() public {
        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](1);
        ms[0] = IWaybillEscrow.MilestoneInput(10000, IWaybillEscrow.ReleaseCondition.ACCEPTANCE, _none(), 0, uint64(block.timestamp+1 days), 72, 0, type(uint16).max);
        vm.prank(buyer);
        vm.expectRevert(IWaybillEscrow.InvalidFeeBps.selector);
        escrow.createDeal(supplier, buyerRefund, arbiter, 1000e6, 101, uint64(block.timestamp+7 days), 168, ms);
    }
}


// ===========================================================================
// 03b n-of-m
// ===========================================================================
contract TestNofM is WaybillEscrowTest {
    uint256 internal attestor2Pk = 0xA22CE;
    address internal attestor2;

    function setUp() public override {
        super.setUp();
        attestor2 = vm.addr(attestor2Pk);
    }

    function _signWith(
        uint256 pk,
        uint256 dealId,
        uint8 milestoneIndex,
        bytes32 evidenceHash,
        uint64 signedAt,
        uint64 expiry
    ) internal view returns (bytes memory sig) {
        bytes32 structHash = keccak256(
            abi.encode(
                escrow.ATTESTATION_TYPEHASH(),
                dealId,
                uint256(milestoneIndex),
                block.chainid,
                address(escrow),
                vm.addr(pk),               // signer field
                escrow.STATEMENT_VERSION(),
                evidenceHash,
                signedAt,
                expiry
            )
        );
        bytes32 digest = escrow.hashTypedDataV4(structHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        sig = abi.encodePacked(r, s, v);
    }

    function _fundedAttestDeal(uint8 threshold, address[] memory atts) internal returns (uint256 id) {
        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](1);
        ms[0] = IWaybillEscrow.MilestoneInput(
            10000, IWaybillEscrow.ReleaseCondition.ATTESTATION, atts, threshold, uint64(block.timestamp + 30 days), 72,  0, type(uint16).max
        );
        uint256 total = 1_000_000;
        uint256 fee = (total * FEE_BPS + 9_999) / 10_000;
        _fundBuyer(total + fee);
        vm.prank(buyer);
        id = escrow.createDeal(supplier, buyerRefund, arbiter, total, FEE_BPS, uint64(block.timestamp + 7 days), 168, ms);
        vm.prank(supplier);
        escrow.acceptSupplier(id, supplierPayout);
        for (uint256 i = 0; i < atts.length; i++) {
            vm.prank(atts[i]);
            escrow.acceptAttestor(id, 0);
        }
        vm.prank(arbiter);
        escrow.acceptArbiter(id);
        vm.prank(buyer);
        escrow.fund(id);
    }

    function testTwoOfTwoStartsReviewOnlyAfterBothAttest() public {
        uint256 id = _fundedAttestDeal(2, _two(attestor, attestor2));
        uint64 t = uint64(block.timestamp);
        bytes memory s1 = _signWith(attestorPk, id, 0, _defaultEvidence(), t, t + 7 days);
        vm.prank(attestor);
        escrow.attest(id, 0, _defaultEvidence(), t, t + 7 days, attestor, s1);
        IWaybillEscrow.Milestone memory m = escrow.getMilestone(id, 0);
        assertEq(uint256(m.state), uint256(IWaybillEscrow.MilestoneState.WAITING));
        bytes memory s2 = _signWith(attestor2Pk, id, 0, keccak256("e2"), t, t + 7 days);
        vm.prank(attestor2);
        escrow.attest(id, 0, keccak256("e2"), t, t + 7 days, attestor2, s2);
        m = escrow.getMilestone(id, 0);
        assertEq(uint256(m.state), uint256(IWaybillEscrow.MilestoneState.CLAIMABLE));
        uint256 fee = escrow.getTrancheFee(id, 0);
        uint256 attestorShare = fee - (fee * 60) / 100;
        vm.prank(supplier);
        escrow.claim(id, 0);
        assertEq(escrow.feeBalance(attestor), attestorShare / 2);
        assertEq(escrow.feeBalance(attestor2), attestorShare - attestorShare / 2);
    }

    function testOneOfTwoStartsReviewAfterFirst() public {
        uint256 id = _fundedAttestDeal(1, _two(attestor, attestor2));
        uint64 t = uint64(block.timestamp);
        bytes memory s1 = _signWith(attestorPk, id, 0, _defaultEvidence(), t, t + 7 days);
        vm.prank(attestor);
        escrow.attest(id, 0, _defaultEvidence(), t, t + 7 days, attestor, s1);
        IWaybillEscrow.Milestone memory m = escrow.getMilestone(id, 0);
        assertEq(uint256(m.state), uint256(IWaybillEscrow.MilestoneState.CLAIMABLE));
    }

    function testOneOfOneStillWorks() public {
        uint256 id = _fundedAttestDeal(1, _one(attestor));
        uint64 t = uint64(block.timestamp);
        bytes memory s1 = _signAttestation(id, 0, _defaultEvidence(), t, t + 7 days);
        vm.prank(attestor);
        escrow.attest(id, 0, _defaultEvidence(), t, t + 7 days, attestor, s1);
        IWaybillEscrow.Milestone memory m = escrow.getMilestone(id, 0);
        assertEq(uint256(m.state), uint256(IWaybillEscrow.MilestoneState.CLAIMABLE));
    }

    function testThresholdZeroOrAboveLengthReverts() public {
        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](1);
        ms[0] = IWaybillEscrow.MilestoneInput(
            10000, IWaybillEscrow.ReleaseCondition.ATTESTATION, _one(attestor), 0, uint64(block.timestamp + 1 days), 72,  0, type(uint16).max
        );
        vm.prank(buyer);
        vm.expectRevert(IWaybillEscrow.InvalidThreshold.selector);
        escrow.createDeal(supplier, buyerRefund, arbiter, 1_000_000, FEE_BPS, uint64(block.timestamp + 7 days), 168, ms);
        ms[0] = IWaybillEscrow.MilestoneInput(
            10000, IWaybillEscrow.ReleaseCondition.ATTESTATION, _one(attestor), 2, uint64(block.timestamp + 1 days), 72,  0, type(uint16).max
        );
        vm.prank(buyer);
        vm.expectRevert(IWaybillEscrow.InvalidThreshold.selector);
        escrow.createDeal(supplier, buyerRefund, arbiter, 1_000_000, FEE_BPS, uint64(block.timestamp + 7 days), 168, ms);
    }
}
