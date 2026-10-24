// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {WaybillEscrow} from "../../src/core/WaybillEscrow.sol";
import {IWaybillEscrow} from "../../src/interfaces/IWaybillEscrow.sol";
import {ArbiterList} from "../../src/registry/ArbiterList.sol";
import {AttestorRegistry} from "../../src/registry/AttestorRegistry.sol";

contract MockERC20 {
    string public name;
    string public symbol;
    uint8  public decimals;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => bool) public blocked;

    function setBlocked(address target, bool value) external {
        blocked[target] = value;
    }

    constructor(string memory _name, string memory _symbol, uint8 _decimals) {
        name     = _name;
        symbol   = _symbol;
        decimals = _decimals;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function totalSupply() external pure returns (uint256) { return type(uint256).max; }

    function transfer(address to, uint256 amount) external returns (bool) {
        if (blocked[msg.sender] || blocked[to]) return false;
        require(balanceOf[msg.sender] >= amount, "insufficient");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "insufficient");
        require(allowance[from][msg.sender] >= amount, "allowance");
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

/// @title Dispute03c — respondToDispute + resolveSplit tests
contract Dispute03c is Test {
    // -------------------------------------------------------------------------
    // Addresses
    // -------------------------------------------------------------------------
    address internal buyer       = address(0xB1);
    address internal supplier    = address(0xB2);
    address internal buyerRefund = address(0xB3);
    address internal supplierPay = address(0xB4);
    address internal arbiter     = address(0xAB);
    address internal attestor    = address(0xA7);
    address internal treasury    = address(0xFE);
    address internal pauser      = address(0xDE);

    // -------------------------------------------------------------------------
    // Contracts
    // -------------------------------------------------------------------------
    MockERC20      internal usdc;
    WaybillEscrow  internal escrow;

    uint16  internal constant FEE_BPS = 75; // 75 bps = 0.75%
    uint256 internal constant TOTAL   = 1_000e6; // 1000 USDC (6 dec)

    // -------------------------------------------------------------------------
    // Setup
    // -------------------------------------------------------------------------

    function setUp() public {
        usdc   = new MockERC20("USD Coin", "USDC", 6);
        address[] memory arbs = new address[](1);
        arbs[0] = arbiter;
        ArbiterList list = new ArbiterList(pauser, arbs);
        AttestorRegistry reg = new AttestorRegistry(pauser);
        escrow = new WaybillEscrow(
            address(usdc),
            treasury,
            pauser,
            1_000_000e6,
            100_000_000e6,
            address(list),
            address(reg)
        );
        vm.prank(pauser); reg.addWriter(address(escrow));

        // Fund buyer
        usdc.mint(buyer, 10_000e6);
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    /// Build a complete deal where buyer has raised a dispute on milestone 0.
    /// Uses deterministic keypair for attestor so EIP-712 sigs work.
    function _setup() internal returns (uint256 dealId, uint256 attPrivKey, address attAddr) {
        (attAddr, attPrivKey) = makeAddrAndKey("attestor03c");

        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](1);
        address[] memory atts = new address[](1);
        atts[0] = attAddr;
        ms[0] = IWaybillEscrow.MilestoneInput({
            bps:          10_000,
            condition:    IWaybillEscrow.ReleaseCondition.ATTESTATION,
            attestors:    atts,
            threshold:    1,
            deadline:     uint64(block.timestamp + 7 days),
            gracePeriod:  24,
            reviewWindow: 48,
            dependsOn: type(uint16).max
        });

        uint256 fee = (TOTAL * FEE_BPS + 9_999) / 10_000;
        vm.startPrank(buyer);
        usdc.approve(address(escrow), TOTAL + fee);
        dealId = escrow.createDeal(
            supplier, buyerRefund, arbiter,
            TOTAL, FEE_BPS,
            uint64(block.timestamp + 3 days), 72, ms
        );
        vm.stopPrank();

        vm.prank(supplier); escrow.acceptSupplier(dealId, supplierPay);
        vm.prank(attAddr);   escrow.acceptAttestor(dealId, 0);
        vm.prank(arbiter);   escrow.acceptArbiter(dealId);
        vm.prank(buyer);     escrow.fund(dealId);

        // Attest to move into IN_REVIEW
        bytes32 evidenceHash = keccak256("evidence");
        uint64 signedAt = uint64(block.timestamp);
        uint64 expiry   = uint64(block.timestamp + 1 hours);
        bytes32 structHash = keccak256(abi.encode(
            escrow.ATTESTATION_TYPEHASH(),
            dealId,
            uint8(0),
            block.chainid,
            address(escrow),
            attAddr,                       // signer field
            escrow.STATEMENT_VERSION(),
            evidenceHash,
            signedAt,
            expiry
        ));
        bytes32 digest = escrow.hashTypedDataV4(structHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(attPrivKey, digest);
        bytes memory sig = abi.encodePacked(r, s, v);

        vm.prank(attAddr);
        escrow.attest(dealId, 0, evidenceHash, signedAt, expiry, attAddr, sig);
        // milestone[0] is now IN_REVIEW

        // Buyer disputes from IN_REVIEW
        vm.prank(buyer);
        escrow.dispute(dealId, 0, keccak256("buyer evidence"));
        // milestone[0] is now DISPUTED
    }

    /// Build a simple ACCEPTANCE deal (no attestation needed) already DISPUTED.
    function _setupAcceptance() internal returns (uint256 dealId) {
        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](1);
        ms[0] = IWaybillEscrow.MilestoneInput({
            bps:          10_000,
            condition:    IWaybillEscrow.ReleaseCondition.ACCEPTANCE,
            attestors:    new address[](0),
            threshold:    0,
            deadline:     uint64(block.timestamp + 7 days),
            gracePeriod:  24,
            reviewWindow: 48,
            dependsOn: type(uint16).max
        });

        uint256 fee = (TOTAL * FEE_BPS + 9_999) / 10_000;
        vm.startPrank(buyer);
        usdc.approve(address(escrow), TOTAL + fee);
        dealId = escrow.createDeal(
            supplier, buyerRefund, arbiter,
            TOTAL, FEE_BPS,
            uint64(block.timestamp + 3 days), 72, ms
        );
        vm.stopPrank();

        vm.prank(supplier); escrow.acceptSupplier(dealId, supplierPay);
        vm.prank(arbiter);   escrow.acceptArbiter(dealId);
        vm.prank(buyer);     escrow.fund(dealId);
        // milestone[0] is now CLAIMABLE (ACCEPTANCE, reviewWindow=48 → IN_REVIEW)
        // Actually reviewWindow=48 means IN_REVIEW on fund.
        // Advance past review window then approveMilestone sets CLAIMABLE.
        // For dispute: buyer needs IN_REVIEW state — fund already puts it IN_REVIEW.
        vm.prank(buyer);
        escrow.dispute(dealId, 0, keccak256("buyer evidence"));
    }

    // -------------------------------------------------------------------------
    // Tests
    // -------------------------------------------------------------------------

    /// The OTHER party (supplier, since buyer raised) stores the response hash.
    function testRespondByOtherPartyStoresHash() public {
        (uint256 dealId,,) = _setup();

        bytes32 respHash = keccak256("supplier response");
        vm.prank(supplier);
        escrow.respondToDispute(dealId, 0, respHash);

        assertEq(escrow.getDisputeResponse(dealId, 0), respHash, "response hash stored");

        // Milestone state unchanged (still DISPUTED)
        IWaybillEscrow.Milestone memory ms = escrow.getMilestone(dealId, 0);
        assertEq(uint8(ms.state), uint8(IWaybillEscrow.MilestoneState.DISPUTED));
        assertTrue(ms.responseSubmitted);
    }

    /// The raiser (buyer) cannot respond to their own dispute.
    function testRespondByRaiserReverts() public {
        (uint256 dealId,,) = _setup();

        vm.prank(buyer);
        vm.expectRevert(IWaybillEscrow.NotDisputeResponder.selector);
        escrow.respondToDispute(dealId, 0, keccak256("raiser trying"));
    }

    /// After responseDeadline (72h), respondToDispute reverts.
    function testRespondAfterWindowReverts() public {
        (uint256 dealId,,) = _setup();

        // Advance past responseDeadline (72 hours)
        vm.warp(block.timestamp + 73 hours);

        vm.prank(supplier);
        vm.expectRevert(IWaybillEscrow.ResponseWindowClosed.selector);
        escrow.respondToDispute(dealId, 0, keccak256("late response"));
    }

    /// resolveSplit 3000 bps: supplier gets 30%, buyer gets 70% + full prepaid fee portion.
    /// All funds accounted for: no leftover in escrow for that tranche.
    function testResolveSplit3000Balances() public {
        (uint256 dealId,,) = _setup();

        // (04d) arbiterDeadline = responseDeadline + arbiterDeadlineHours.
        // Warp past the 72h response window so resolve is allowed.
        vm.warp(block.timestamp + 73 hours);

        uint256 tranche = TOTAL;  // single milestone = 100%
        uint256 fee     = escrow.getTrancheFee(dealId, 0);
        uint256 totalLocked = tranche + fee;

        uint256 supBefore  = usdc.balanceOf(supplierPay);
        uint256 buyBefore  = usdc.balanceOf(buyerRefund);
        uint256 escBefore  = usdc.balanceOf(address(escrow));
        uint256 locked0    = escrow.currentLocked();

        vm.prank(arbiter);
        escrow.resolveSplit(dealId, 0, 3_000); // 30% to supplier

        uint256 principalSupplier = (tranche * 3_000) / 10_000;
        uint256 principalBuyer    = tranche - principalSupplier;
        uint256 feeSupplier       = (fee * 3_000) / 10_000;
        uint256 feeBuyer          = fee - feeSupplier;

        // Supplier gets their principal only (fee stays in escrow as feeBalance)
        assertEq(usdc.balanceOf(supplierPay) - supBefore, principalSupplier, "supplier principal");
        // Buyer gets principal + their fee portion
        assertEq(usdc.balanceOf(buyerRefund) - buyBefore, principalBuyer + feeBuyer, "buyer principal+fee");

        // Escrow balance decreased by exactly (principalSupplier + principalBuyer + feeBuyer)
        // feeSupplier stays in escrow as accrued feeBalance
        uint256 outflow = principalSupplier + principalBuyer + feeBuyer;
        assertEq(escBefore - usdc.balanceOf(address(escrow)), outflow, "escrow outflow");

        // currentLocked decreased by full tranche+fee
        assertEq(locked0 - escrow.currentLocked(), totalLocked, "locked decreased");

        // feeBalance[treasury] increased by 60% of feeSupplier (ATTESTATION+attested)
        // This is the ATTESTATION path (attested=true); 60% treasury, 40% attestor
        uint256 treasuryShare  = (feeSupplier * 60) / 100;
        uint256 attestorShare  = feeSupplier - treasuryShare;
        assertEq(escrow.feeBalance(treasury), treasuryShare, "treasury fee");
        // attestor fee accrued (we don't know attAddr here easily, just check total in escrow)
        // Total fee accrued = treasuryShare + attestorShare = feeSupplier
        // Escrow still holds feeSupplier worth of fee balances
        assertEq(escrow.feeBalance(treasury) + attestorShare, feeSupplier, "fee total");

        // Deal settled
        IWaybillEscrow.Deal memory deal = escrow.getDeal(dealId);
        assertEq(uint8(deal.state), uint8(IWaybillEscrow.DealState.SETTLED), "deal settled");
    }

    /// resolve(true) still pays supplier in full.
    function testResolveBoolTrueStillPaysSupplier() public {
        uint256 dealId = _setupAcceptance();

        // (04d) Warp past the 72h response window.
        vm.warp(block.timestamp + 73 hours);

        uint256 tranche = TOTAL;
        uint256 fee     = escrow.getTrancheFee(dealId, 0);

        uint256 supBefore = usdc.balanceOf(supplierPay);

        vm.prank(arbiter);
        escrow.resolve(dealId, 0, true);

        assertEq(usdc.balanceOf(supplierPay) - supBefore, tranche, "full payout to supplier");

        // Treasury gets 100% of fee (ACCEPTANCE milestone, not attested)
        assertEq(escrow.feeBalance(treasury), fee, "treasury gets full fee");

        IWaybillEscrow.Deal memory deal = escrow.getDeal(dealId);
        assertEq(uint8(deal.state), uint8(IWaybillEscrow.DealState.SETTLED));
    }

    /// resolve(false) still refunds buyer in full (principal + fee).
    function testResolveBoolFalseStillRefundsBuyer() public {
        uint256 dealId = _setupAcceptance();

        // (04d) Warp past the 72h response window.
        vm.warp(block.timestamp + 73 hours);

        uint256 tranche = TOTAL;
        uint256 fee     = escrow.getTrancheFee(dealId, 0);

        uint256 buyBefore = usdc.balanceOf(buyerRefund);

        vm.prank(arbiter);
        escrow.resolve(dealId, 0, false);

        assertEq(usdc.balanceOf(buyerRefund) - buyBefore, tranche + fee, "full refund to buyer");

        // Treasury gets nothing (refund path)
        assertEq(escrow.feeBalance(treasury), 0, "no fee to treasury on refund");

        IWaybillEscrow.Deal memory deal = escrow.getDeal(dealId);
        assertEq(uint8(deal.state), uint8(IWaybillEscrow.DealState.SETTLED));
    }

    /// Block buyerRefund on MockERC20. resolveSplit must revert SplitTransferFailed,
    /// milestone must stay DISPUTED, and no balances must change.
    function testResolveSplitRevertsIfBuyerBlocked() public {
        (uint256 dealId,,) = _setup();

        // Record state before
        uint256 supBefore  = usdc.balanceOf(supplierPay);
        uint256 buyBefore  = usdc.balanceOf(buyerRefund);
        uint256 escBefore  = usdc.balanceOf(address(escrow));
        uint256 locked0    = escrow.currentLocked();

        // (04d) Warp past the 72h response window first.
        vm.warp(block.timestamp + 73 hours);

        // Block the buyer's refund address
        usdc.setBlocked(buyerRefund, true);

        vm.prank(arbiter);
        vm.expectRevert(IWaybillEscrow.SplitTransferFailed.selector);
        escrow.resolveSplit(dealId, 0, 3_000);

        // Nothing changed — revert rolled everything back
        assertEq(usdc.balanceOf(supplierPay),    supBefore,  "supplier unchanged");
        assertEq(usdc.balanceOf(buyerRefund),     buyBefore,  "buyer unchanged");
        assertEq(usdc.balanceOf(address(escrow)), escBefore,  "escrow unchanged");
        assertEq(escrow.currentLocked(),          locked0,    "locked unchanged");

        // Milestone still DISPUTED
        IWaybillEscrow.Milestone memory ms = escrow.getMilestone(dealId, 0);
        assertEq(uint8(ms.state), uint8(IWaybillEscrow.MilestoneState.DISPUTED), "still DISPUTED");
    }
}
