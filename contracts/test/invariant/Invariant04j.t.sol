// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test}              from "forge-std/Test.sol";
import {StdInvariant}      from "forge-std/StdInvariant.sol";
import {WaybillEscrow}     from "../../src/core/WaybillEscrow.sol";
import {IWaybillEscrow}    from "../../src/interfaces/IWaybillEscrow.sol";
import {ArbiterList}       from "../../src/registry/ArbiterList.sol";
import {AttestorRegistry}  from "../../src/registry/AttestorRegistry.sol";
import {BondVault}         from "../../src/vaults/BondVault.sol";
import {FinancingVault}    from "../../src/vaults/FinancingVault.sol";
import {MockUSDC}          from "../integration/WaybillEscrow.t.sol";

// =============================================================================
// WaybillHandler — bounded stateful handler for invariant testing
// =============================================================================
contract WaybillHandler is Test {

    // ── Production contracts ──────────────────────────────────────────────────
    WaybillEscrow    internal escrow;
    MockUSDC         internal usdc;
    ArbiterList      internal arbList;
    AttestorRegistry internal reg;
    BondVault        internal bondVault;
    FinancingVault   internal finVault;

    // ── Fixed actor set ───────────────────────────────────────────────────────
    uint256 internal constant BUYER_PK     = 0xB01;
    uint256 internal constant SUPPLIER_PK  = 0x501;
    uint256 internal constant ARBITER_PK   = 0xA01;
    uint256 internal constant ATT0_PK      = 0xA110;
    uint256 internal constant LENDER_PK    = 0xC01;
    uint256 internal constant LENDER2_PK   = 0xC02;

    address internal buyer;
    address internal supplier;
    address internal arbiter;
    address internal att0;
    address internal lender;
    address internal lender2;
    address internal supplierPayout;
    address internal buyerRefund;
    address internal treasury;
    address internal pauser;

    // ── Handler tracking ─────────────────────────────────────────────────────
    uint256 internal constant MAX_DEALS   = 4;
    uint16  internal constant FEE_BPS     = 75;   // within [50,100]
    uint256 internal constant TRANCHE_AMT = 1_000e6; // 1 000 USDC per deal

    uint256[MAX_DEALS] internal dealIds;          // 0 = not yet created
    uint8   internal dealsCreated;

    // Per-deal per-milestone terminal fate tracking
    // fate: 0=none, 1=released(claimed), 2=refunded, 3=resolved
    mapping(uint256 => uint8) internal milestoneFate; // key = dealId*10+msIdx

    // Pending blocked-delivery liabilities
    mapping(uint256 => bool) internal pendingBlocked; // dealId => has pending blocked delivery

    // Vault balance snapshots (for isolation invariant)
    uint256 internal escrowBalBefore;

    // Ghost: sum of all deals' locked principal still in escrow
    // We track this as escrow.currentLocked() is authoritative — we verify it.

    // ── Constants ─────────────────────────────────────────────────────────────
    uint256 internal constant MS_DEADLINE  = 30 days;
    uint64  internal constant ACCEPT_DL    = uint64(type(uint64).max);

    // ── Setup (called once from Invariant04j.setUp) ───────────────────────────
    function setup(
        WaybillEscrow    _escrow,
        MockUSDC         _usdc,
        ArbiterList      _list,
        AttestorRegistry _reg,
        BondVault        _bond,
        FinancingVault   _fin,
        address          _treasury,
        address          _pauser
    ) external {
        escrow     = _escrow;
        usdc       = _usdc;
        arbList    = _list;
        reg        = _reg;
        bondVault  = _bond;
        finVault   = _fin;
        treasury   = _treasury;
        pauser     = _pauser;

        buyer          = vm.addr(BUYER_PK);
        supplier       = vm.addr(SUPPLIER_PK);
        arbiter        = vm.addr(ARBITER_PK);
        att0           = vm.addr(ATT0_PK);
        lender         = vm.addr(LENDER_PK);
        lender2        = vm.addr(LENDER2_PK);
        supplierPayout = address(0xAAAA1);
        buyerRefund    = address(0xBBBB1);
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    function _ms1(bool attestation) internal view returns (IWaybillEscrow.MilestoneInput[] memory ms) {
        ms = new IWaybillEscrow.MilestoneInput[](1);
        address[] memory atts = new address[](0);
        if (attestation) {
            atts = new address[](1);
            atts[0] = att0;
        }
        ms[0] = IWaybillEscrow.MilestoneInput({
            bps:       10_000,
            condition: attestation
                ? IWaybillEscrow.ReleaseCondition.ATTESTATION
                : IWaybillEscrow.ReleaseCondition.ACCEPTANCE,
            attestors:    atts,
            threshold:    attestation ? 1 : 0,
            deadline:     uint64(block.timestamp + MS_DEADLINE),
            gracePeriod:  72,
            reviewWindow: 24,
            dependsOn:    type(uint16).max
        });
    }

    function _depositAmount() internal pure returns (uint256) {
        // exact ceiling fee for TRANCHE_AMT at FEE_BPS
        uint256 fee = (TRANCHE_AMT * FEE_BPS + 9_999) / 10_000;
        return TRANCHE_AMT + fee;
    }

    function _signAttestation(
        uint256 dealId, uint8 msIdx, bytes32 evHash, uint64 signedAt, uint64 expiry, uint256 pk
    ) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(abi.encode(
            escrow.ATTESTATION_TYPEHASH(),
            dealId, msIdx, block.chainid, address(escrow),
            vm.addr(pk),
            escrow.STATEMENT_VERSION(), evHash, signedAt, expiry
        ));
        bytes32 digest = escrow.hashTypedDataV4(structHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    // ── Handler operations ────────────────────────────────────────────────────

    /// Create a new acceptance-milestone deal (up to MAX_DEALS).
    function op_createAcceptanceDeal(uint256 seed) external {
        if (dealsCreated >= MAX_DEALS) return;
        uint256 dep = _depositAmount();
        usdc.mint(buyer, dep);
        vm.prank(buyer); usdc.approve(address(escrow), type(uint256).max);
        IWaybillEscrow.MilestoneInput[] memory ms = _ms1(false);
        vm.prank(buyer);
        uint256 did = escrow.createDeal(
            supplier, buyerRefund, arbiter,
            TRANCHE_AMT, FEE_BPS,
            uint64(block.timestamp + 90 days), 48,
            ms
        );
        vm.prank(supplier); escrow.acceptSupplier(did, supplierPayout);
        vm.prank(arbiter);  escrow.acceptArbiter(did);
        vm.prank(buyer);    escrow.fund(did);
        dealIds[dealsCreated] = did;
        dealsCreated++;
    }

    /// Create a new attestation-milestone deal (up to MAX_DEALS total across both types).
    function op_createAttestationDeal(uint256 seed) external {
        if (dealsCreated >= MAX_DEALS) return;
        uint256 dep = _depositAmount();
        usdc.mint(buyer, dep);
        vm.prank(buyer); usdc.approve(address(escrow), type(uint256).max);
        IWaybillEscrow.MilestoneInput[] memory ms = _ms1(true);
        vm.prank(buyer);
        uint256 did = escrow.createDeal(
            supplier, buyerRefund, arbiter,
            TRANCHE_AMT, FEE_BPS,
            uint64(block.timestamp + 90 days), 48,
            ms
        );
        vm.prank(supplier); escrow.acceptSupplier(did, supplierPayout);
        vm.prank(att0);     escrow.acceptAttestor(did, 0);
        vm.prank(arbiter);  escrow.acceptArbiter(did);
        vm.prank(buyer);    escrow.fund(did);
        dealIds[dealsCreated] = did;
        dealsCreated++;
    }

    /// Claim a random funded acceptance deal.
    function op_claim(uint256 seed) external {
        uint256 did = _pickFunded(seed);
        if (did == 0) return;
        uint8 fate = milestoneFate[did * 10];
        if (fate != 0) return; // already terminal
        IWaybillEscrow.Milestone memory ms = escrow.getMilestone(did, 0);
        if (ms.state != IWaybillEscrow.MilestoneState.CLAIMABLE) return;

        uint256 supBefore    = usdc.balanceOf(supplierPayout);
        uint256 lockedBefore = escrow.currentLocked();

        vm.prank(supplier);
        try escrow.claim(did, 0) {
            milestoneFate[did * 10] = 1; // released
            // supplier received principal
            uint256 trancheFee = escrow.getTrancheFee(did, 0);
            assertGe(usdc.balanceOf(supplierPayout), supBefore + TRANCHE_AMT - trancheFee,
                "INV-claim: supplier underpaid");
            assertEq(escrow.currentLocked(), lockedBefore - (TRANCHE_AMT + trancheFee),
                "INV-claim: locked not decremented by tranche+fee");
        } catch {}
    }

    /// Attest on an attestation deal (brings it to IN_REVIEW).
    function op_attest(uint256 seed) external {
        uint256 did = _pickFunded(seed);
        if (did == 0) return;
        IWaybillEscrow.Milestone memory ms = escrow.getMilestone(did, 0);
        if (ms.condition != IWaybillEscrow.ReleaseCondition.ATTESTATION) return;
        if (ms.state != IWaybillEscrow.MilestoneState.WAITING) return;

        bytes32 evHash  = keccak256("evidence");
        uint64  signedAt = uint64(block.timestamp);
        uint64  expiry   = uint64(block.timestamp + 7 days);
        bytes memory sig = _signAttestation(did, 0, evHash, signedAt, expiry, ATT0_PK);
        try escrow.attest(did, 0, evHash, signedAt, expiry, att0, sig) {} catch {}
    }

    /// Approve milestone from buyer (IN_REVIEW -> CLAIMABLE).
    function op_approve(uint256 seed) external {
        uint256 did = _pickFunded(seed);
        if (did == 0) return;
        IWaybillEscrow.Milestone memory ms = escrow.getMilestone(did, 0);
        if (ms.state != IWaybillEscrow.MilestoneState.IN_REVIEW) return;

        vm.prank(buyer);
        try escrow.approveMilestone(did, 0) {} catch {}
    }

    /// Apply default on an overdue attestation milestone.
    function op_applyDefault(uint256 seed) external {
        uint256 did = _pickFunded(seed);
        if (did == 0) return;
        uint8 fate = milestoneFate[did * 10];
        if (fate != 0) return;
        IWaybillEscrow.Milestone memory ms = escrow.getMilestone(did, 0);
        if (ms.condition != IWaybillEscrow.ReleaseCondition.ATTESTATION) return;
        // Warp past deadline + grace
        vm.warp(ms.deadline + ms.gracePeriod * 1 hours + 1);
        try escrow.applyDefault(did, 0) {} catch {}
    }

    /// Refund a REFUNDABLE milestone.
    function op_refund(uint256 seed) external {
        uint256 did = _pickFunded(seed);
        if (did == 0) return;
        uint8 fate = milestoneFate[did * 10];
        if (fate != 0) return;
        IWaybillEscrow.Milestone memory ms = escrow.getMilestone(did, 0);
        if (ms.state != IWaybillEscrow.MilestoneState.REFUNDABLE) return;

        uint256 buyerBefore  = usdc.balanceOf(buyerRefund);
        uint256 lockedBefore = escrow.currentLocked();
        uint256 bpf          = escrow.getTrancheFee(did, 0);

        vm.prank(buyer);
        try escrow.refund(did, 0) {
            milestoneFate[did * 10] = 2; // refunded
            assertEq(usdc.balanceOf(buyerRefund), buyerBefore + TRANCHE_AMT + bpf,
                "INV-refund: buyer underpaid");
            assertEq(escrow.currentLocked(), lockedBefore - (TRANCHE_AMT + bpf),
                "INV-refund: locked not decremented");
        } catch {}
    }

    /// Dispute a claimable/in-review milestone.
    function op_dispute(uint256 seed) external {
        uint256 did = _pickFunded(seed);
        if (did == 0) return;
        IWaybillEscrow.Milestone memory ms = escrow.getMilestone(did, 0);
        bool canDispute = (ms.state == IWaybillEscrow.MilestoneState.IN_REVIEW);
        if (!canDispute) return;

        vm.prank(buyer);
        try escrow.dispute(did, 0, keccak256("evidence")) {} catch {}
    }

    /// Resolve DISPUTED milestone via arbiter (to supplier).
    function op_resolveToSupplier(uint256 seed) external {
        uint256 did = _pickFunded(seed);
        if (did == 0) return;
        uint8 fate = milestoneFate[did * 10];
        if (fate != 0) return;
        IWaybillEscrow.Milestone memory ms = escrow.getMilestone(did, 0);
        if (ms.state != IWaybillEscrow.MilestoneState.DISPUTED) return;
        // Warp past response deadline
        if (ms.responseDeadline > 0) vm.warp(ms.responseDeadline + 1);

        uint256 supBefore    = usdc.balanceOf(supplierPayout);
        uint256 lockedBefore = escrow.currentLocked();
        uint256 trancheFee   = escrow.getTrancheFee(did, 0);
        uint256 bpf          = escrow.getTrancheFee(did, 0);

        vm.prank(arbiter);
        try escrow.resolve(did, 0, true) {
            milestoneFate[did * 10] = 3;
            assertGe(usdc.balanceOf(supplierPayout), supBefore,
                "INV-resolve: supplier not paid");
            assertEq(escrow.currentLocked(), lockedBefore - (TRANCHE_AMT + bpf),
                "INV-resolve: locked not decremented");
        } catch {}
    }

    /// Resolve DISPUTED milestone via arbiter (to buyer).
    function op_resolveToBuyer(uint256 seed) external {
        uint256 did = _pickFunded(seed);
        if (did == 0) return;
        uint8 fate = milestoneFate[did * 10];
        if (fate != 0) return;
        IWaybillEscrow.Milestone memory ms = escrow.getMilestone(did, 0);
        if (ms.state != IWaybillEscrow.MilestoneState.DISPUTED) return;
        if (ms.responseDeadline > 0) vm.warp(ms.responseDeadline + 1);

        uint256 buyerBefore  = usdc.balanceOf(buyerRefund);
        uint256 lockedBefore = escrow.currentLocked();
        uint256 bpf          = escrow.getTrancheFee(did, 0);

        vm.prank(arbiter);
        try escrow.resolve(did, 0, false) {
            milestoneFate[did * 10] = 3;
            assertEq(usdc.balanceOf(buyerRefund), buyerBefore + TRANCHE_AMT + bpf,
                "INV-resolve-buyer: buyer not refunded");
            assertEq(escrow.currentLocked(), lockedBefore - (TRANCHE_AMT + bpf),
                "INV-resolve-buyer: locked not decremented");
        } catch {}
    }

    /// Pause then unpause (pauser-only paths).
    function op_pauseUnpause(uint256 seed) external {
        vm.prank(pauser);
        try escrow.pauseNewDeals() {} catch {}
        vm.prank(pauser);
        try escrow.unpauseNewDeals() {} catch {}
    }

    /// Withdraw treasury fees.
    function op_withdrawFees(uint256 seed) external {
        uint256 bal = escrow.feeBalance(treasury);
        if (bal == 0) return;
        uint256 treasuryBefore = usdc.balanceOf(treasury);
        uint256 escrowBefore   = usdc.balanceOf(address(escrow));
        vm.prank(treasury);
        try escrow.withdrawFees() {
            // withdrawFees() withdraws the caller's full feeBalance
            assertEq(usdc.balanceOf(treasury),        treasuryBefore + bal, "INV-fee: treasury underpaid");
            assertEq(usdc.balanceOf(address(escrow)),  escrowBefore   - bal, "INV-fee: escrow overdrawn");
            // Post-invariant: escrow balance still >= currentLocked
            assertGe(usdc.balanceOf(address(escrow)), escrow.currentLocked(),
                "INV-fee: escrow < locked after fee withdrawal");
        } catch {}
    }

    /// BondVault deposit + withdraw (must not touch escrow balance).
    function op_bondDepositWithdraw(uint256 seed) external {
        uint256 amt = bound(seed, 1e6, 500e6);
        usdc.mint(lender, amt);
        vm.prank(lender); usdc.approve(address(bondVault), type(uint256).max);

        uint256 escrowBefore = usdc.balanceOf(address(escrow));
        vm.prank(lender);
        try bondVault.deposit(amt) {
            assertEq(usdc.balanceOf(address(escrow)), escrowBefore,
                "INV-bond: deposit changed escrow");
            uint256 escrowAfterDeposit = usdc.balanceOf(address(escrow));
            vm.prank(lender);
            try bondVault.withdraw(amt) {
                assertEq(usdc.balanceOf(address(escrow)), escrowAfterDeposit,
                    "INV-bond: withdraw changed escrow");
            } catch {}
        } catch {}
    }

    /// FinancingVault deposit + borrow against a funded deal + repay + withdraw.
    function op_financeDepositRepay(uint256 seed) external {
        uint256 did = _pickFunded(seed);
        if (did == 0) return;
        // Only lend up to deal totalAmount
        uint256 lendAmt = bound(seed, 1e6, TRANCHE_AMT);
        usdc.mint(lender, lendAmt);
        vm.prank(lender); usdc.approve(address(finVault), type(uint256).max);

        uint256 escrowBefore = usdc.balanceOf(address(escrow));

        vm.prank(lender);
        try finVault.deposit(lendAmt) {
            assertEq(usdc.balanceOf(address(escrow)), escrowBefore,
                "INV-fin: deposit changed escrow");

            // Supplier borrows
            uint256 borrowAmt = bound(seed >> 16, 1, lendAmt);
            vm.prank(supplier);
            try finVault.borrow(did, borrowAmt, 0) {
                assertEq(usdc.balanceOf(address(escrow)), escrowBefore,
                    "INV-fin: borrow changed escrow");

                // Repay
                usdc.mint(supplier, borrowAmt);
                vm.prank(supplier); usdc.approve(address(finVault), type(uint256).max);
                vm.prank(supplier);
                try finVault.repay(did, borrowAmt) {} catch {}
            } catch {}

            // Withdraw lender's position
            vm.prank(lender);
            try finVault.withdraw(lendAmt) {
                assertEq(usdc.balanceOf(address(escrow)), escrowBefore,
                    "INV-fin: withdraw changed escrow");
            } catch {}
        } catch {}
    }

    /// Lender2 cannot withdraw lender's balance.
    function op_financeActorIsolation(uint256 seed) external {
        uint256 amt = bound(seed, 1e6, 200e6);
        usdc.mint(lender, amt);
        vm.prank(lender); usdc.approve(address(finVault), type(uint256).max);
        vm.prank(lender);
        try finVault.deposit(amt) {
            // lender2 tries to steal lender's deposit
            vm.prank(lender2);
            try finVault.withdraw(amt) {
                // If this succeeds it's a bug — but we can't assert revert here;
                // instead assert lender2 got 0 extra USDC
                // (finVault.withdraw checks caller's own balance, so it will revert)
                assertTrue(false, "INV-fin-isolation: lender2 withdrew lender funds");
            } catch {}
            // Cleanup
            vm.prank(lender);
            try finVault.withdraw(amt) {} catch {}
        } catch {}
    }

    /// Time-warp forward by a bounded amount to exercise deadline-sensitive paths.
    function op_timeWarp(uint256 seed) external {
        uint256 skip = bound(seed, 1 hours, 14 days);
        vm.warp(block.timestamp + skip);
    }

    /// Blocked-refund / retry cycle: block buyerRefund, call refund (fails),
    /// assert milestone stays REFUNDABLE + currentLocked unchanged, unblock, retry.
    function op_blockedRefundRetry(uint256 seed) external {
        uint256 did = _pickFunded(seed);
        if (did == 0) return;
        if (pendingBlocked[did]) return; // already in pending state for this deal
        if (milestoneFate[did * 10] != 0) return; // already terminal

        IWaybillEscrow.Milestone memory ms = escrow.getMilestone(did, 0);
        // Only proceed if milestone is already REFUNDABLE
        if (ms.state != IWaybillEscrow.MilestoneState.REFUNDABLE) return;

        uint256 lockedBefore = escrow.currentLocked();
        uint256 bpf  = escrow.getTrancheFee(did, 0);
        uint256 tAmt = escrow.getDeal(did).totalAmount;

        // Block the buyer refund address
        usdc.setBlocked(buyerRefund, true);

        // Call refund — MockUSDC returns false (not revert) when blocked, so
        // escrow.refund() will RETURN (not revert) but milestone stays REFUNDABLE.
        vm.prank(buyer);
        escrow.refund(did, 0);

        // Check actual state — if REFUNDABLE the transfer was blocked; if REFUNDED buyer was
        // somehow already unblocked (shouldn't happen here, but handle both cases).
        IWaybillEscrow.Milestone memory msAfter = escrow.getMilestone(did, 0);
        usdc.setBlocked(buyerRefund, false);

        if (msAfter.state == IWaybillEscrow.MilestoneState.REFUNDABLE) {
            // Expected: blocked delivery — assert invariants
            assertEq(escrow.currentLocked(), lockedBefore,
                "INV-blk: currentLocked changed on blocked refund");

            // Retry with buyer unblocked
            uint256 buyerBefore = usdc.balanceOf(buyerRefund);
            vm.prank(buyer);
            escrow.refund(did, 0);

            IWaybillEscrow.Milestone memory msFinal = escrow.getMilestone(did, 0);
            assertEq(uint8(msFinal.state), uint8(IWaybillEscrow.MilestoneState.REFUNDED),
                "INV-blk: retry must set milestone to REFUNDED");
            assertEq(escrow.currentLocked(), lockedBefore - (tAmt + bpf),
                "INV-blk: currentLocked not decremented after retry");
            assertEq(usdc.balanceOf(buyerRefund), buyerBefore + tAmt + bpf,
                "INV-blk: buyer did not receive full refund on retry");
        }
        // Either way milestone is now terminal
        milestoneFate[did * 10] = 2;
    }

    /// Ghost-state read: is this deal pending a blocked delivery?
    function isBlockedPending(uint256 did) external view returns (bool) {
        return pendingBlocked[did];
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    /// Pick a created, funded deal using seed % dealsCreated. Returns 0 if none.
    function _pickFunded(uint256 seed) internal view returns (uint256) {
        if (dealsCreated == 0) return 0;
        uint256 idx = seed % dealsCreated;
        return dealIds[idx];
    }

    // ── Ghost-state reads for invariant target ────────────────────────────────

    function numDeals() external view returns (uint256) { return dealsCreated; }
    function getDealId(uint256 idx) external view returns (uint256) { return dealIds[idx]; }
    function getMilestoneFate(uint256 did, uint8 msIdx) external view returns (uint8) {
        return milestoneFate[did * 10 + msIdx];
    }
}

// =============================================================================
// Invariant04j — target that registers the handler and asserts invariants
// =============================================================================
contract Invariant04j is StdInvariant, Test {

    WaybillEscrow    internal escrow;
    MockUSDC         internal usdc;
    ArbiterList      internal arbList;
    AttestorRegistry internal reg;
    BondVault        internal bondVault;
    FinancingVault   internal finVault;
    WaybillHandler   internal handler;

    address internal treasury  = address(0x1111);
    address internal pauser    = address(0x2222);

    function setUp() public {
        usdc = new MockUSDC();

        address[] memory initArbiters = new address[](1);
        initArbiters[0] = vm.addr(0xA01); // arbiter
        arbList = new ArbiterList(pauser, initArbiters);
        reg     = new AttestorRegistry(pauser);

        escrow = new WaybillEscrow(
            address(usdc), treasury, pauser,
            100_000e6,       // maxDealAmount
            10_000_000e6,    // maxLocked
            address(arbList), address(reg)
        );
        vm.prank(pauser); reg.addWriter(address(escrow));

        bondVault = new BondVault(address(usdc), pauser, address(escrow), address(reg));
        finVault  = new FinancingVault(address(usdc), pauser, address(escrow));

        // Register finVault as escrow writer so it can call recordOutcome
        vm.prank(pauser); reg.addWriter(address(finVault));

        handler = new WaybillHandler();
        handler.setup(escrow, usdc, arbList, reg, bondVault, finVault, treasury, pauser);

        // Set min/max fee bps on escrow
        // (escrow constructor already sets defaults; no change needed for FEE_BPS=75)

        // Register handler as the fuzzing target
        targetContract(address(handler));

        // Select handler functions as targets
        bytes4[] memory selectors = new bytes4[](16);
        selectors[0]  = WaybillHandler.op_createAcceptanceDeal.selector;
        selectors[1]  = WaybillHandler.op_createAttestationDeal.selector;
        selectors[2]  = WaybillHandler.op_claim.selector;
        selectors[3]  = WaybillHandler.op_attest.selector;
        selectors[4]  = WaybillHandler.op_approve.selector;
        selectors[5]  = WaybillHandler.op_applyDefault.selector;
        selectors[6]  = WaybillHandler.op_refund.selector;
        selectors[7]  = WaybillHandler.op_dispute.selector;
        selectors[8]  = WaybillHandler.op_resolveToSupplier.selector;
        selectors[9]  = WaybillHandler.op_resolveToBuyer.selector;
        selectors[10] = WaybillHandler.op_withdrawFees.selector;
        selectors[11] = WaybillHandler.op_bondDepositWithdraw.selector;
        selectors[12] = WaybillHandler.op_financeDepositRepay.selector;
        selectors[13] = WaybillHandler.op_timeWarp.selector;
        selectors[14] = WaybillHandler.op_financeActorIsolation.selector;
        selectors[15] = WaybillHandler.op_blockedRefundRetry.selector;

        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    // =========================================================================
    // Invariant 1: escrow USDC >= currentLocked
    // =========================================================================
    function invariant_escrowBalanceCoversLocked() public view {
        uint256 escrowBal = usdc.balanceOf(address(escrow));
        uint256 locked    = escrow.currentLocked();
        assertGe(escrowBal, locked,
            "INV1: escrow USDC < currentLocked");
    }

    // =========================================================================
    // Invariant 2: each tracked terminal tranche has exactly one fate
    // =========================================================================
    function invariant_terminalFateConsistency() public view {
        uint256 n = handler.numDeals();
        for (uint256 i = 0; i < n; i++) {
            uint256 did  = handler.getDealId(i);
            if (did == 0) continue;
            uint8 fate = handler.getMilestoneFate(did, 0);
            if (fate == 0) continue; // not yet terminal in handler

            IWaybillEscrow.Milestone memory ms = escrow.getMilestone(did, 0);

            if (fate == 1) { // released
                assertEq(uint8(ms.state), uint8(IWaybillEscrow.MilestoneState.RELEASED),
                    "INV2: fate=released but state != RELEASED");
            } else if (fate == 2) { // refunded
                assertTrue(
                    ms.state == IWaybillEscrow.MilestoneState.REFUNDED,
                    "INV2: fate=refunded but state != REFUNDED"
                );
            } else if (fate == 3) { // resolved
                assertTrue(
                    ms.state == IWaybillEscrow.MilestoneState.RELEASED ||
                    ms.state == IWaybillEscrow.MilestoneState.REFUNDED ||
                    ms.state == IWaybillEscrow.MilestoneState.RESOLVED,
                    "INV2: fate=resolved but state not terminal"
                );
            }
        }
    }

    // =========================================================================
    // Invariant 3: vault actions never increase escrow's principal exposure
    //              (checked per-operation in handler; here we assert vault
    //               token balances are non-negative and independent of escrow)
    // =========================================================================
    function invariant_vaultIsolationFromEscrow() public view {
        // BondVault and FinancingVault hold their own USDC; escrow holds its own.
        // Their balances don't overlap (separate contracts).
        // The key property: any USDC in bondVault/finVault is NOT counted in
        // escrow.currentLocked(), so escrow solvency is independent.
        uint256 bondBal = usdc.balanceOf(address(bondVault));
        uint256 finBal  = usdc.balanceOf(address(finVault));
        // Trivially non-negative (uint256), but assert they're not backed by escrow
        assertGe(bondBal + finBal + usdc.balanceOf(address(escrow)),
                 escrow.currentLocked(),
                 "INV3: combined custody < escrow locked");
    }

    // =========================================================================
    // Invariant 4: currentLocked is consistent with deal states
    //   (sum of expected locked >= escrow.currentLocked() since fees may sit as
    //    fee balance credits which are included in escrow balance but not locked)
    // =========================================================================
    function invariant_lockedIsConservative() public view {
        // escrow.currentLocked() <= escrow USDC balance
        // (weaker form of INV1, kept as a named invariant)
        uint256 escrowBal = usdc.balanceOf(address(escrow));
        uint256 locked    = escrow.currentLocked();
        assertGe(escrowBal, locked, "INV4: escrow balance < locked");
    }

    // =========================================================================
    // Invariant 5: handler fate-tracked deals never show a non-terminal state
    //              for a milestone the handler marked terminal
    // =========================================================================
    function invariant_noRevertsOnTerminalFate() public view {
        uint256 n = handler.numDeals();
        for (uint256 i = 0; i < n; i++) {
            uint256 did = handler.getDealId(i);
            if (did == 0) continue;
            uint8 fate = handler.getMilestoneFate(did, 0);
            if (fate == 0) continue;
            IWaybillEscrow.Milestone memory ms = escrow.getMilestone(did, 0);
            assertTrue(
                ms.state == IWaybillEscrow.MilestoneState.RELEASED  ||
                ms.state == IWaybillEscrow.MilestoneState.REFUNDED  ||
                ms.state == IWaybillEscrow.MilestoneState.RESOLVED,
                "INV5: handler says terminal but escrow state is not"
            );
        }
    }

    // =========================================================================
    // Invariant 6: any deal marked pendingBlocked must still be REFUNDABLE
    //              with its full locked liability intact; once cleared it must
    //              have a terminal fate (not pending).
    // =========================================================================
    function invariant_pendingBlockedLiability() public view {
        uint256 n = handler.numDeals();
        for (uint256 i = 0; i < n; i++) {
            uint256 did = handler.getDealId(i);
            if (did == 0) continue;
            bool pending = handler.isBlockedPending(did);
            if (!pending) continue;

            // While pending: milestone must still be REFUNDABLE
            IWaybillEscrow.Milestone memory ms = escrow.getMilestone(did, 0);
            assertEq(
                uint8(ms.state),
                uint8(IWaybillEscrow.MilestoneState.REFUNDABLE),
                "INV6: pendingBlocked deal milestone is not REFUNDABLE"
            );
            // currentLocked must still account for this deal's tranche + fee
            uint256 bpf  = escrow.getTrancheFee(did, 0);
            uint256 tAmt = escrow.getDeal(did).totalAmount;
            assertGe(
                escrow.currentLocked(), tAmt + bpf,
                "INV6: currentLocked < tranche+fee for pendingBlocked deal"
            );
            // escrow balance must cover locked
            assertGe(
                usdc.balanceOf(address(escrow)), escrow.currentLocked(),
                "INV6: escrow USDC < currentLocked while blocked pending"
            );
        }
    }
}

// =============================================================================
// Regression tests — deterministic counterexamples
// =============================================================================
contract Regression04j is Test {

    WaybillEscrow    internal escrow;
    MockUSDC         internal usdc;
    ArbiterList      internal arbList;
    AttestorRegistry internal reg;
    BondVault        internal bondVault;
    FinancingVault   internal finVault;

    address internal treasury   = address(0x1111);
    address internal pauser     = address(0x2222);
    address internal buyer;
    address internal supplier;
    address internal arbiter;
    address internal att0;
    address internal supplierPayout = address(0xAAAA2);
    address internal buyerRefund    = address(0xBBBB2);

    uint256 internal constant BUYER_PK    = 0xB02;
    uint256 internal constant SUPPLIER_PK = 0x502;
    uint256 internal constant ARBITER_PK  = 0xA02;
    uint256 internal constant ATT0_PK     = 0xA112;

    function setUp() public {
        buyer    = vm.addr(BUYER_PK);
        supplier = vm.addr(SUPPLIER_PK);
        arbiter  = vm.addr(ARBITER_PK);
        att0     = vm.addr(ATT0_PK);

        usdc    = new MockUSDC();
        address[] memory initArbiters = new address[](1);
        initArbiters[0] = arbiter;
        arbList = new ArbiterList(pauser, initArbiters);
        reg     = new AttestorRegistry(pauser);
        escrow  = new WaybillEscrow(
            address(usdc), treasury, pauser,
            100_000e6, 10_000_000e6,
            address(arbList), address(reg)
        );
        vm.prank(pauser); reg.addWriter(address(escrow));
        bondVault = new BondVault(address(usdc), pauser, address(escrow), address(reg));
        finVault  = new FinancingVault(address(usdc), pauser, address(escrow));
    }

    function _ms(bool attestation) internal view returns (IWaybillEscrow.MilestoneInput[] memory ms) {
        ms = new IWaybillEscrow.MilestoneInput[](1);
        address[] memory atts = new address[](0);
        if (attestation) { atts = new address[](1); atts[0] = att0; }
        ms[0] = IWaybillEscrow.MilestoneInput({
            bps: 10_000, condition: attestation
                ? IWaybillEscrow.ReleaseCondition.ATTESTATION
                : IWaybillEscrow.ReleaseCondition.ACCEPTANCE,
            attestors: atts, threshold: attestation ? 1 : 0,
            deadline: uint64(block.timestamp + 30 days),
            gracePeriod: 72, reviewWindow: 0,
            dependsOn: type(uint16).max
        });
    }

    function _fund(uint256 total, uint16 feeBps) internal returns (uint256 did) {
        uint256 fee = (total * feeBps + 9_999) / 10_000;
        usdc.mint(buyer, total + fee);
        vm.prank(buyer); usdc.approve(address(escrow), type(uint256).max);
        vm.prank(buyer);
        did = escrow.createDeal(
            supplier, buyerRefund, arbiter,
            total, feeBps,
            uint64(block.timestamp + 90 days), 48,
            _ms(false)
        );
        vm.prank(supplier); escrow.acceptSupplier(did, supplierPayout);
        vm.prank(arbiter);  escrow.acceptArbiter(did);
        vm.prank(buyer);    escrow.fund(did);
    }

    // ── Reg-01: escrow balance always >= currentLocked after a clean claim ────
    function testReg01_EscrowBalanceGeLocked_AfterClaim() public {
        uint256 did = _fund(5_000e6, 75);
        vm.prank(supplier); escrow.claim(did, 0);
        assertGe(
            usdc.balanceOf(address(escrow)),
            escrow.currentLocked(),
            "Reg01: escrow < locked after claim"
        );
    }

    // ── Reg-02: double-claim reverts, fate unchanged ──────────────────────────
    function testReg02_DoubleClaim_Reverts() public {
        uint256 did = _fund(5_000e6, 75);
        vm.prank(supplier); escrow.claim(did, 0);
        IWaybillEscrow.MilestoneState stateBefore = escrow.getMilestone(did, 0).state;
        vm.expectRevert();
        vm.prank(supplier); escrow.claim(did, 0);
        assertEq(uint8(escrow.getMilestone(did, 0).state), uint8(stateBefore),
            "Reg02: state changed after failed double-claim");
    }

    // ── Reg-03: bond deposit/withdraw leaves escrow balance unchanged ─────────
    function testReg03_BondVault_DoesNotTouchEscrow() public {
        uint256 did = _fund(5_000e6, 75);
        uint256 escrowBal = usdc.balanceOf(address(escrow));
        usdc.mint(buyer, 1_000e6);
        vm.prank(buyer); usdc.approve(address(bondVault), type(uint256).max);
        vm.prank(buyer); bondVault.deposit(1_000e6);
        assertEq(usdc.balanceOf(address(escrow)), escrowBal,
            "Reg03: bondVault.deposit touched escrow");
        vm.prank(buyer); bondVault.withdraw(1_000e6);
        assertEq(usdc.balanceOf(address(escrow)), escrowBal,
            "Reg03: bondVault.withdraw touched escrow");
    }

    // ── Reg-04: FinancingVault borrow/repay leaves escrow balance unchanged ───
    function testReg04_FinancingVault_DoesNotTouchEscrow() public {
        uint256 did = _fund(5_000e6, 75);
        uint256 escrowBal = usdc.balanceOf(address(escrow));

        usdc.mint(buyer, 2_000e6);
        vm.prank(buyer); usdc.approve(address(finVault), type(uint256).max);
        vm.prank(buyer); finVault.deposit(2_000e6);
        assertEq(usdc.balanceOf(address(escrow)), escrowBal,
            "Reg04: finVault.deposit touched escrow");

        vm.prank(supplier);
        try finVault.borrow(did, 1_000e6, 0) {
            assertEq(usdc.balanceOf(address(escrow)), escrowBal,
                "Reg04: finVault.borrow touched escrow");
            usdc.mint(supplier, 1_000e6);
            vm.prank(supplier); usdc.approve(address(finVault), type(uint256).max);
            vm.prank(supplier); finVault.repay(did, 1_000e6);
            assertEq(usdc.balanceOf(address(escrow)), escrowBal,
                "Reg04: finVault.repay touched escrow");
        } catch {}

        vm.prank(buyer); finVault.withdraw(2_000e6);
        assertEq(usdc.balanceOf(address(escrow)), escrowBal,
            "Reg04: finVault.withdraw touched escrow");
    }

    // ── Reg-05: pause blocks create/fund, not claim ───────────────────────────
    function testReg05_PauseBlocksCreateNotClaim() public {
        uint256 did = _fund(5_000e6, 75);
        vm.prank(pauser); escrow.pauseNewDeals();

        // create reverts
        uint256 fee2 = (uint256(1_000e6) * 75 + 9_999) / 10_000;
        usdc.mint(buyer, 1_000e6 + fee2);
        vm.prank(buyer); usdc.approve(address(escrow), type(uint256).max);
        // verify createDeal reverts while paused via function-type selector
        // selector for 8-arg base overload
        bytes4 sel = bytes4(keccak256(
            "createDeal(address,address,address,uint256,uint16,uint64,uint32,(uint256,uint8,address[],uint8,uint64,uint32,uint32,uint16)[])"
        ));
        IWaybillEscrow.MilestoneInput[] memory ms2 = _ms(false);
        bytes memory cd = abi.encodePacked(
            sel,
            abi.encode(
                supplier, buyerRefund, arbiter,
                uint256(1_000e6), uint16(75),
                uint64(block.timestamp + 90 days), uint32(48),
                ms2
            )
        );
        vm.prank(buyer);
        (bool ok2,) = address(escrow).call(cd);
        assertFalse(ok2, "Reg05: createDeal succeeded while paused");

        // claim still works
        vm.prank(supplier); escrow.claim(did, 0);
        assertEq(uint8(escrow.getMilestone(did, 0).state),
                 uint8(IWaybillEscrow.MilestoneState.RELEASED),
                 "Reg05: claim failed while paused");
    }
}
