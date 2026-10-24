// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {WaybillEscrow} from "../../src/core/WaybillEscrow.sol";
import {IWaybillEscrow} from "../../src/interfaces/IWaybillEscrow.sol";
import {ArbiterList} from "../../src/registry/ArbiterList.sol";
import {AttestorRegistry} from "../../src/registry/AttestorRegistry.sol";

// ---------------------------------------------------------------------------
// Minimal ERC-20 mock with optional per-address transfer block
// ---------------------------------------------------------------------------
contract MockUSDC03d {
    uint8 public decimals = 6;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => bool) public blocked;

    function setBlocked(address target, bool value) external { blocked[target] = value; }
    function mint(address to, uint256 amount) external { balanceOf[to] += amount; }
    function totalSupply() external pure returns (uint256) { return type(uint256).max; }

    function transfer(address to, uint256 amount) external returns (bool) {
        if (blocked[msg.sender] || blocked[to]) return false;
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
// Test suite
// ---------------------------------------------------------------------------
contract AddressChange03d is Test {
    uint256 internal constant USDC_6     = 1e6;
    uint256 internal constant TOTAL      = 1_000 * USDC_6;
    uint16  internal constant FEE_BPS    = 75;
    uint64  internal constant DELAY      = 48 hours;

    MockUSDC03d internal usdc;
    WaybillEscrow internal escrow;

    address internal buyer        = address(0xB1);
    address internal supplier     = address(0xB2);
    address internal supplierPay  = address(0xB4);
    address internal buyerRefund  = address(0xB3);
    address internal arbiter      = address(0xAB);
    address internal treasury     = address(0xFE);
    address internal pauser       = address(0xDE);

    // -------------------------------------------------------------------------
    // Setup
    // -------------------------------------------------------------------------

    function setUp() public {
        usdc = new MockUSDC03d();

        address[] memory arbs = new address[](1);
        arbs[0] = arbiter;
        ArbiterList list = new ArbiterList(pauser, arbs);
        AttestorRegistry reg = new AttestorRegistry(pauser);
        escrow = new WaybillEscrow(
            address(usdc), treasury, pauser,
            100_000 * USDC_6, 10_000_000 * USDC_6, address(list), address(reg)
        );
        vm.prank(pauser); reg.addWriter(address(escrow));

        // Label addresses for trace clarity
        vm.label(buyer,       "buyer");
        vm.label(supplier,    "supplier");
        vm.label(supplierPay, "supplierPay");
        vm.label(buyerRefund, "buyerRefund");
        vm.label(arbiter,     "arbiter");
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    function _fee(uint256 amount, uint16 bps) internal pure returns (uint256) {
        return (amount * bps + 9_999) / 10_000;
    }

    /// Creates, accepts, and funds a single ACCEPTANCE milestone deal.
    /// Returns the dealId.
    function _fundedDeal() internal returns (uint256 dealId) {
        uint256 prepaidFee = _fee(TOTAL, FEE_BPS);

        usdc.mint(buyer, TOTAL + prepaidFee);
        vm.prank(buyer);
        usdc.approve(address(escrow), TOTAL + prepaidFee);

        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](1);
        ms[0] = IWaybillEscrow.MilestoneInput({
            bps:         10_000,
            condition:   IWaybillEscrow.ReleaseCondition.ACCEPTANCE,
            attestors:   new address[](0),
            threshold:   0,
            deadline:    uint64(block.timestamp + 30 days),
            gracePeriod: 72,
            reviewWindow: 0,
            dependsOn: type(uint16).max
        });

        vm.prank(buyer);
        dealId = escrow.createDeal(
            supplier, buyerRefund, arbiter,
            TOTAL, FEE_BPS,
            uint64(block.timestamp + 7 days), 168, ms
        );

        vm.prank(supplier); escrow.acceptSupplier(dealId, supplierPay);
        vm.prank(arbiter);  escrow.acceptArbiter(dealId);
        vm.prank(buyer);    escrow.fund(dealId);
    }

    // -------------------------------------------------------------------------
    // Tests
    // -------------------------------------------------------------------------

    /// testProposeThenApplyAfter48hClaimPaysNewPayout:
    /// 1. Block old payout — first claim attempt leaves milestone CLAIMABLE.
    /// 2. Supplier proposes new payout address.
    /// 3. Warp 48 h; anyone applies the change.
    /// 4. Second claim pays new address.
    function testProposeThenApplyAfter48hClaimPaysNewPayout() public {
        uint256 dealId = _fundedDeal();

        // Fund escrow so claim actually transfers tokens
        usdc.mint(address(escrow), TOTAL + _fee(TOTAL, FEE_BPS));

        address newPayout = address(0xC0);

        // Block old payout so first claim fails (leaves CLAIMABLE)
        usdc.setBlocked(supplierPay, true);
        escrow.claim(dealId, 0);
        // Still CLAIMABLE after failed payout
        assertEq(
            uint8(escrow.getMilestone(dealId, 0).state),
            uint8(IWaybillEscrow.MilestoneState.CLAIMABLE),
            "should remain CLAIMABLE"
        );

        // Propose new payout
        vm.prank(supplier);
        escrow.proposePayout(dealId, newPayout);

        IWaybillEscrow.PendingAddressChange memory p = escrow.getPendingPayoutChange(dealId);
        assertEq(p.proposed, newPayout, "proposal stored");

        // Still before eta — applyPayoutChange must revert
        vm.expectRevert(IWaybillEscrow.ChangeDelayActive.selector);
        escrow.applyPayoutChange(dealId);

        // Warp past the 48-hour delay
        vm.warp(block.timestamp + DELAY + 1);

        // Unblock old, so we can distinguish which address gets paid
        usdc.setBlocked(supplierPay, false);

        // Apply — anyone can call
        escrow.applyPayoutChange(dealId);
        assertEq(escrow.getDeal(dealId).supplierPayout, newPayout, "payout updated");
        assertEq(escrow.getPendingPayoutChange(dealId).proposed, address(0), "proposal cleared");

        // Claim now pays new address
        uint256 before = usdc.balanceOf(newPayout);
        escrow.claim(dealId, 0);
        assertGt(usdc.balanceOf(newPayout), before, "new payout received funds");
    }

    /// testApplyBeforeDelayReverts: applying before 48 h elapses must revert ChangeDelayActive.
    function testApplyBeforeDelayReverts() public {
        uint256 dealId = _fundedDeal();

        vm.prank(supplier);
        escrow.proposePayout(dealId, address(0xC1));

        // 1 second before eta
        IWaybillEscrow.PendingAddressChange memory p = escrow.getPendingPayoutChange(dealId);
        vm.warp(p.eta - 1);

        vm.expectRevert(IWaybillEscrow.ChangeDelayActive.selector);
        escrow.applyPayoutChange(dealId);

        // Exactly at eta succeeds
        vm.warp(p.eta);
        escrow.applyPayoutChange(dealId); // no revert
    }

    /// testBuyerRejectsPayoutChange: buyer can cancel the pending proposal; apply then reverts.
    function testBuyerRejectsPayoutChange() public {
        uint256 dealId = _fundedDeal();

        vm.prank(supplier);
        escrow.proposePayout(dealId, address(0xC2));

        // Non-buyer cannot reject
        vm.prank(supplier);
        vm.expectRevert(IWaybillEscrow.NotBuyerForPayout.selector);
        escrow.rejectPayoutChange(dealId);

        // Buyer rejects
        vm.prank(buyer);
        escrow.rejectPayoutChange(dealId);
        assertEq(escrow.getPendingPayoutChange(dealId).proposed, address(0), "cleared after reject");

        // apply now reverts NoPendingChange
        vm.warp(block.timestamp + DELAY + 1);
        vm.expectRevert(IWaybillEscrow.NoPendingChange.selector);
        escrow.applyPayoutChange(dealId);

        // Supplier payout address unchanged
        assertEq(escrow.getDeal(dealId).supplierPayout, supplierPay, "payout unchanged");
    }

    /// testRefundAddressChangeAfterDelay: buyer proposes new refund address;
    /// supplier cannot reject own proposal via rejectRefundChange (that's supplier's role here);
    /// after delay refund goes to new address.
    function testRefundAddressChangeAfterDelay() public {
        uint256 dealId = _fundedDeal();

        address newRefund = address(0xD0);

        // Non-buyer cannot propose
        vm.prank(supplier);
        vm.expectRevert(IWaybillEscrow.NotBuyerForRefund.selector);
        escrow.proposeRefundAddress(dealId, newRefund);

        // Buyer proposes
        vm.prank(buyer);
        escrow.proposeRefundAddress(dealId, newRefund);

        IWaybillEscrow.PendingAddressChange memory p = escrow.getPendingRefundChange(dealId);
        assertEq(p.proposed, newRefund, "refund proposal stored");

        // Supplier can reject
        vm.prank(supplier);
        escrow.rejectRefundChange(dealId);
        assertEq(escrow.getPendingRefundChange(dealId).proposed, address(0), "rejected");

        // Propose again
        vm.prank(buyer);
        escrow.proposeRefundAddress(dealId, newRefund);

        // Warp and apply
        vm.warp(block.timestamp + DELAY + 1);
        escrow.applyRefundChange(dealId);

        assertEq(escrow.getDeal(dealId).buyerRefund, newRefund, "refund address updated");
        assertEq(escrow.getPendingRefundChange(dealId).proposed, address(0), "proposal cleared");
    }
}
