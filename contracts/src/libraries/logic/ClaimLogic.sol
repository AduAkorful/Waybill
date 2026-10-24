// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20}            from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20}         from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IWaybillEscrow}    from "../../interfaces/IWaybillEscrow.sol";
import {IAttestorRegistry} from "../../interfaces/IAttestorRegistry.sol";
import {WaybillStorage}    from "../../core/WaybillStorage.sol";

/// @title ClaimLogic
/// @notice External library for claim, refund, withdrawFees, and the internal
///         payment helpers _paySupplier / _refundBuyer / _checkAndSettleDeal.
///         All functions run via DELEGATECALL in the escrow's storage context.
library ClaimLogic {
    using SafeERC20 for IERC20;

    // -------------------------------------------------------------------------
    // claim
    // -------------------------------------------------------------------------

    function executeClaim(address usdc_, address registry_, uint256 dealId, uint8 milestoneIndex) external {
        WaybillStorage.Layout storage s = _layout();
        IWaybillEscrow.Deal storage deal = s.deals[dealId];
        if (deal.state != IWaybillEscrow.DealState.FUNDED)    revert IWaybillEscrow.InvalidDealState();
        if (milestoneIndex >= deal.milestoneCount)             revert IWaybillEscrow.InvalidMilestone();

        IWaybillEscrow.Milestone storage ms = s.milestones[dealId][milestoneIndex];
        _markOverdueIfNeeded(ms);

        if (ms.state == IWaybillEscrow.MilestoneState.WAITING &&
            ms.condition == IWaybillEscrow.ReleaseCondition.TIMED)
        {
            if (block.timestamp < ms.deadline) revert IWaybillEscrow.TimedNotReached();
            if (ms.reviewWindow == 0) {
                ms.state = IWaybillEscrow.MilestoneState.CLAIMABLE;
                emit IWaybillEscrow.MilestoneClaimable(dealId, milestoneIndex);
            } else {
                ms.state = IWaybillEscrow.MilestoneState.IN_REVIEW;
                ms.reviewWindowStart = uint64(block.timestamp);
                emit IWaybillEscrow.ReviewWindowStarted(dealId, milestoneIndex, ms.reviewWindowStart, ms.reviewWindow);
                return;
            }
        }

        if (ms.state == IWaybillEscrow.MilestoneState.IN_REVIEW) {
            uint64 unlockTs = ms.reviewWindowStart + uint64(ms.reviewWindow) * 1 hours;
            if (block.timestamp < unlockTs) revert IWaybillEscrow.ReviewActive();
            ms.state = IWaybillEscrow.MilestoneState.CLAIMABLE;
            emit IWaybillEscrow.MilestoneClaimable(dealId, milestoneIndex);
        }

        if (ms.state != IWaybillEscrow.MilestoneState.CLAIMABLE) revert IWaybillEscrow.NotClaimable();

        // Fix: fund-first deals must satisfy the same full-accept predicate as normal fund
        // before any tranche can be paid out.
        if (deal.supplierPayout == address(0)) revert IWaybillEscrow.SupplierNotAccepted();
        if (!_isFullyAccepted(s, deal, dealId))  revert IWaybillEscrow.NotFullyAccepted();

        // (04f) Dependency gate: prerequisite must be RELEASED before payout.
        {
            uint16 dep = s.milestoneDependsOn[dealId][milestoneIndex];
            if (dep != type(uint16).max) {
                if (s.milestones[dealId][dep].state != IWaybillEscrow.MilestoneState.RELEASED)
                    revert IWaybillEscrow.DependencyNotReleased();
            }
        }

        ms.state = IWaybillEscrow.MilestoneState.RELEASED;
        bool paid = _paySupplier(s, usdc_, dealId, milestoneIndex);
        if (!paid) return;

        emit IWaybillEscrow.TrancheClaimed(dealId, milestoneIndex, deal.supplierPayout,
            _trancheAmount(s, dealId, milestoneIndex));
        _checkAndSettleDeal(s, usdc_, registry_, dealId);
    }

    // -------------------------------------------------------------------------
    // refund
    // -------------------------------------------------------------------------

    function executeRefund(address usdc_, address registry_, uint256 dealId, uint8 milestoneIndex) external {
        WaybillStorage.Layout storage s = _layout();
        IWaybillEscrow.Deal storage deal = s.deals[dealId];
        if (deal.state != IWaybillEscrow.DealState.FUNDED)    revert IWaybillEscrow.InvalidDealState();
        if (milestoneIndex >= deal.milestoneCount)             revert IWaybillEscrow.InvalidMilestone();

        IWaybillEscrow.Milestone storage ms = s.milestones[dealId][milestoneIndex];
        if (ms.state != IWaybillEscrow.MilestoneState.REFUNDABLE) revert IWaybillEscrow.NotRefundable();

        ms.state = IWaybillEscrow.MilestoneState.REFUNDED;
        _refundBuyer(s, usdc_, dealId, milestoneIndex);

        // ── 04e: cascade refund — sweep every later unreleased non-disputed milestone ──
        // Skip RELEASED, REFUNDED, RESOLVED (already terminal — already paid or settled).
        // Skip DISPUTED (frozen under active dispute; deal cannot settle while DISPUTED).
        // Sweep WAITING, OVERDUE, REFUNDABLE, CLAIMABLE, IN_REVIEW → REFUNDED.
        uint8 n = deal.milestoneCount;
        for (uint8 i = milestoneIndex + 1; i < n; i++) {
            IWaybillEscrow.Milestone storage later = s.milestones[dealId][i];
            IWaybillEscrow.MilestoneState st = later.state;
            // Already terminal — nothing to do
            if (st == IWaybillEscrow.MilestoneState.RELEASED  ||
                st == IWaybillEscrow.MilestoneState.REFUNDED  ||
                st == IWaybillEscrow.MilestoneState.RESOLVED)  continue;
            // Frozen under active dispute — do not touch
            if (st == IWaybillEscrow.MilestoneState.DISPUTED)  continue;
            // Sweep: WAITING, OVERDUE, REFUNDABLE, CLAIMABLE, IN_REVIEW.
            // State is set inside _cascadeRefundBuyer: REFUNDED on success, REFUNDABLE on failure.
            _cascadeRefundBuyer(s, usdc_, dealId, i);
        }

        _checkAndSettleDeal(s, usdc_, registry_, dealId);
    }

    /// @notice (04e) Retry a cascade-refund tranche whose buyer-transfer previously failed.
    function executeRetryCascadeRefund(address usdc_, address registry_, uint256 dealId, uint8 milestoneIndex) external {
        WaybillStorage.Layout storage s = _layout();
        uint256 pending = s.cascadeRefundPending[dealId][milestoneIndex];
        if (pending == 0) revert IWaybillEscrow.CascadeRefundNotPending();

        IWaybillEscrow.Deal storage deal = s.deals[dealId];

        (bool ok, bytes memory ret) = usdc_.call(
            abi.encodeWithSignature("transfer(address,uint256)", deal.buyerRefund, pending)
        );
        bool success = ok && (ret.length == 0 || abi.decode(ret, (bool)));
        if (!success) revert IWaybillEscrow.RefundTransferFailed();

        s.currentLocked -= pending;
        s.cascadeRefundPending[dealId][milestoneIndex] = 0;
        s.milestones[dealId][milestoneIndex].state = IWaybillEscrow.MilestoneState.REFUNDED;
        emit IWaybillEscrow.CascadeRefundRetried(dealId, milestoneIndex, deal.buyerRefund, pending);

        _checkAndSettleDeal(s, usdc_, registry_, dealId);
    }

    // -------------------------------------------------------------------------
    // withdrawFees
    // -------------------------------------------------------------------------

    function executeWithdrawFees(address usdc_) external {
        WaybillStorage.Layout storage s = _layout();
        uint256 amount = s.feeBalances[msg.sender];
        if (amount == 0) revert IWaybillEscrow.NoFees();
        s.feeBalances[msg.sender] = 0;
        IERC20(usdc_).safeTransfer(msg.sender, amount);
        emit IWaybillEscrow.FeesWithdrawn(msg.sender, amount);
    }

    // -------------------------------------------------------------------------
    // _paySupplier (internal — used by DisputeLogic too via shared slot)
    // -------------------------------------------------------------------------

    function paySupplier(address usdc_, address registry_, uint256 dealId, uint8 milestoneIndex)
        external returns (bool)
    {
        WaybillStorage.Layout storage s = _layout();
        bool paid = _paySupplier(s, usdc_, dealId, milestoneIndex);
        if (paid) _checkAndSettleDeal(s, usdc_, registry_, dealId);
        return paid;
    }

    function refundBuyer(address usdc_, address registry_, uint256 dealId, uint8 milestoneIndex)
        external returns (bool)
    {
        WaybillStorage.Layout storage s = _layout();
        bool ok = _refundBuyer(s, usdc_, dealId, milestoneIndex);
        if (ok) _checkAndSettleDeal(s, usdc_, registry_, dealId);
        return ok;
    }

    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------

    function _isFullyAccepted(
        WaybillStorage.Layout storage s,
        IWaybillEscrow.Deal storage deal,
        uint256 dealId
    ) private view returns (bool) {
        if (deal.supplierPayout == address(0)) return false;
        if (!deal.arbiterAccepted)             return false;
        uint8 n = deal.milestoneCount;
        for (uint8 i = 0; i < n; i++) {
            if (s.milestones[dealId][i].condition == IWaybillEscrow.ReleaseCondition.ATTESTATION) {
                if (s.acceptedCount[dealId][i] < s.attestorCount[dealId][i]) return false;
            }
        }
        return true;
    }

    function _trancheAmount(
        WaybillStorage.Layout storage s,
        uint256 dealId,
        uint8   milestoneIndex
    ) internal view returns (uint256) {
        IWaybillEscrow.Deal storage deal = s.deals[dealId];
        IWaybillEscrow.Milestone storage ms = s.milestones[dealId][milestoneIndex];
        if (milestoneIndex + 1 == deal.milestoneCount) {
            uint256 accumulated;
            for (uint8 i = 0; i < milestoneIndex; i++) {
                accumulated += (deal.totalAmount * s.milestones[dealId][i].bps) / 10_000;
            }
            return deal.totalAmount - accumulated;
        }
        return (deal.totalAmount * ms.bps) / 10_000;
    }

    function _creditAttestorFees(
        WaybillStorage.Layout storage s,
        uint256 dealId,
        uint8   milestoneIndex,
        uint8   totalAttestors,
        uint8   attestedCount,
        uint256 total,
        bool    add
    ) private {
        uint256 per = total / attestedCount;
        uint256 running;
        uint8   seen;
        for (uint8 j = 0; j < totalAttestors; j++) {
            address att = s.attestors[dealId][milestoneIndex][j];
            if (s.hasAttested[dealId][milestoneIndex][att]) {
                seen += 1;
                uint256 share = (seen == attestedCount) ? total - running : per;
                if (add) s.feeBalances[att] += share;
                else     s.feeBalances[att] -= share;
                running += share;
            }
        }
    }

    function _paySupplier(
        WaybillStorage.Layout storage s,
        address usdc_,
        uint256 dealId,
        uint8   milestoneIndex
    ) private returns (bool) {
        IWaybillEscrow.Deal storage deal = s.deals[dealId];
        IWaybillEscrow.Milestone storage ms = s.milestones[dealId][milestoneIndex];
        address dealTreasury = deal.protocolTreasury;

        uint256 trancheAmount = _trancheAmount(s, dealId, milestoneIndex);
        uint256 fee = s.trancheFees[dealId][milestoneIndex];
        uint256 bpf = s.buyerPaidFee[dealId][milestoneIndex]; // (04g) buyer's deposited portion of fee

        // (04g) Accounting:
        //   currentLocked tracks exactly what buyer deposited per tranche: principal + buyerPaidFee.
        //   BuyerPrepaid:      bpf == fee  → locked -= tranche + fee
        //   SupplierDeducted:  bpf == 0    → locked -= tranche
        //   Split:             bpf == half → locked -= tranche + half
        s.currentLocked -= (trancheAmount + bpf);

        uint256 treasuryAccrued;
        uint256 attestorAccrued;

        if (ms.condition == IWaybillEscrow.ReleaseCondition.ATTESTATION && ms.attested) {
            treasuryAccrued = (fee * 60) / 100;
            attestorAccrued = fee - treasuryAccrued;
            s.feeBalances[dealTreasury] += treasuryAccrued;
            uint8 totalAtt = s.attestorCount[dealId][milestoneIndex];
            _creditAttestorFees(s, dealId, milestoneIndex, totalAtt, ms.attestCount, attestorAccrued, true);
        } else {
            treasuryAccrued = fee;
            s.feeBalances[dealTreasury] += fee;
        }

        // (04g) Supplier payout = tranche minus any fee deducted from supplier.
        // BuyerPrepaid:      supplierDeducted = 0      → supplier gets full tranche
        // SupplierDeducted:  supplierDeducted = fee    → supplier gets tranche - fee
        // Split:             supplierDeducted = fee-half → supplier gets tranche - (fee-half)
        uint256 supplierDeducted = fee - bpf;
        uint256 supplierPayout = trancheAmount - supplierDeducted;

        // Non-reverting transfer: fail-safe for USDC blocklist
        (bool success, bytes memory ret) = usdc_.call(
            abi.encodeWithSignature("transfer(address,uint256)", deal.supplierPayout, supplierPayout)
        );
        bool ok = success && (ret.length == 0 || abi.decode(ret, (bool)));

        if (!ok) {
            s.currentLocked += (trancheAmount + bpf);
            s.feeBalances[dealTreasury] -= treasuryAccrued;
            if (ms.condition == IWaybillEscrow.ReleaseCondition.ATTESTATION && ms.attested) {
                uint8 totalAtt = s.attestorCount[dealId][milestoneIndex];
                _creditAttestorFees(s, dealId, milestoneIndex, totalAtt, ms.attestCount, attestorAccrued, false);
            }
            ms.state = IWaybillEscrow.MilestoneState.CLAIMABLE;
            emit IWaybillEscrow.PayoutFailed(dealId, milestoneIndex, deal.supplierPayout, supplierPayout);
            return false;
        }
        return true;
    }

    /// @dev (04e) Cascade a single later milestone.
    ///      On success:  sets milestone REFUNDED, decrements currentLocked.
    ///      On failure:  sets milestone REFUNDABLE (non-terminal, retryable),
    ///                   restores currentLocked, stores cascadeRefundPending for retry.
    function _cascadeRefundBuyer(
        WaybillStorage.Layout storage s,
        address usdc_,
        uint256 dealId,
        uint8   milestoneIndex
    ) private {
        IWaybillEscrow.Deal storage deal = s.deals[dealId];
        IWaybillEscrow.Milestone storage ms = s.milestones[dealId][milestoneIndex];
        uint256 trancheAmount = _trancheAmount(s, dealId, milestoneIndex);
        // (04g) Buyer only gets back what they deposited: principal + their fee portion.
        uint256 bpf = s.buyerPaidFee[dealId][milestoneIndex];
        uint256 payout = trancheAmount + bpf;

        s.currentLocked -= payout;

        (bool success, bytes memory ret) = usdc_.call(
            abi.encodeWithSignature("transfer(address,uint256)", deal.buyerRefund, payout)
        );
        bool ok = success && (ret.length == 0 || abi.decode(ret, (bool)));

        if (!ok) {
            // Transfer failed: keep milestone retryable (REFUNDABLE), restore locked.
            s.currentLocked += payout;
            ms.state = IWaybillEscrow.MilestoneState.REFUNDABLE;
            s.cascadeRefundPending[dealId][milestoneIndex] = payout;
            emit IWaybillEscrow.CascadeRefundPending(dealId, milestoneIndex, deal.buyerRefund, payout);
            return;
        }
        // Transfer succeeded: finalize.
        ms.state = IWaybillEscrow.MilestoneState.REFUNDED;
        emit IWaybillEscrow.CascadeRefunded(dealId, milestoneIndex, deal.buyerRefund, trancheAmount, bpf);
    }

    function _refundBuyer(
        WaybillStorage.Layout storage s,
        address usdc_,
        uint256 dealId,
        uint8   milestoneIndex
    ) private returns (bool) {
        IWaybillEscrow.Deal storage deal = s.deals[dealId];
        IWaybillEscrow.Milestone storage ms = s.milestones[dealId][milestoneIndex];
        uint256 trancheAmount = _trancheAmount(s, dealId, milestoneIndex);
        // (04g) Buyer only gets back what they deposited: principal + their fee portion.
        uint256 bpf = s.buyerPaidFee[dealId][milestoneIndex];
        uint256 payout = trancheAmount + bpf;

        s.currentLocked -= payout;

        (bool success, bytes memory ret) = usdc_.call(
            abi.encodeWithSignature("transfer(address,uint256)", deal.buyerRefund, payout)
        );
        bool ok = success && (ret.length == 0 || abi.decode(ret, (bool)));

        if (!ok) {
            s.currentLocked += payout;
            ms.state = IWaybillEscrow.MilestoneState.REFUNDABLE;
            emit IWaybillEscrow.RefundFailed(dealId, milestoneIndex, deal.buyerRefund, payout);
            return false;
        }
        emit IWaybillEscrow.TrancheRefunded(dealId, milestoneIndex, deal.buyerRefund, trancheAmount, bpf);
        return true;
    }

    /// @dev (04c) Non-reverting arbiter fee refund to buyer on no-dispute settle.
    ///      H-04c-2: on failure, stores arbiterFeeRefundPending for retry after address change.
    ///      H-04c-3 (pending accounting): currentLocked decremented ONLY on successful delivery.
    function _refundArbiterFeeOnSettle(
        WaybillStorage.Layout storage s,
        address usdc_,
        uint256 dealId,
        IWaybillEscrow.Deal storage deal
    ) private {
        uint256 fee = deal.arbiterFee;
        if (fee == 0 || s.arbiterFeePaid[dealId] || s.arbiterFeeRefunded[dealId]) return;
        if (s.arbiterFeeRefundPending[dealId] > 0) return;
        (bool ok, bytes memory ret) = usdc_.call(
            abi.encodeWithSignature("transfer(address,uint256)", deal.buyerRefund, fee)
        );
        bool success = ok && (ret.length == 0 || abi.decode(ret, (bool)));
        if (!success) {
            // H-04c-3: do NOT decrement currentLocked — fee stays locked until retry succeeds.
            s.arbiterFeeRefundPending[dealId] = fee;
            emit IWaybillEscrow.ArbiterFeeRefundPending(dealId, deal.buyerRefund, fee);
            return;
        }
        s.currentLocked -= fee;   // H-04c-3: decrement only on delivery
        s.arbiterFeeRefunded[dealId] = true;
        emit IWaybillEscrow.ArbiterFeeRefunded(dealId, deal.buyerRefund, fee);
    }

    function _markOverdueIfNeeded(IWaybillEscrow.Milestone storage ms) private {
        if (
            ms.state == IWaybillEscrow.MilestoneState.WAITING &&
            ms.condition != IWaybillEscrow.ReleaseCondition.TIMED &&
            block.timestamp > ms.deadline
        ) {
            ms.state = IWaybillEscrow.MilestoneState.OVERDUE;
        }
    }

    function _checkAndSettleDeal(
        WaybillStorage.Layout storage s,
        address usdc_,
        address registry_,
        uint256 dealId
    ) internal {
        IWaybillEscrow.Deal storage deal = s.deals[dealId];
        if (deal.state == IWaybillEscrow.DealState.SETTLED) return;

        uint8 n = deal.milestoneCount;
        for (uint8 i = 0; i < n; i++) {
            IWaybillEscrow.MilestoneState ms = s.milestones[dealId][i].state;
            if (ms != IWaybillEscrow.MilestoneState.RELEASED &&
                ms != IWaybillEscrow.MilestoneState.REFUNDED &&
                ms != IWaybillEscrow.MilestoneState.RESOLVED)
            {
                return;
            }
            // (04e) Block settlement while a cascade refund transfer is still pending.
            // The milestone is marked REFUNDED optimistically, but the USDC has not yet
            // reached the buyer — arbiter-fee settlement must not run until delivery is confirmed.
            if (s.cascadeRefundPending[dealId][i] > 0) return;
        }

        deal.state = IWaybillEscrow.DealState.SETTLED;
        deal.settled = true;
        emit IWaybillEscrow.DealSettled(dealId);

        // (04c) No dispute ever settled this deal → refund arbiter fee to buyer exactly once
        _refundArbiterFeeOnSettle(s, usdc_, dealId, deal);

        // Push one recordOutcome(Attested) per unique attestor who attested at least one milestone.
        // Dedup by checking prior milestones (avoids large memory array).
        for (uint8 i = 0; i < n; i++) {
            if (s.milestones[dealId][i].condition != IWaybillEscrow.ReleaseCondition.ATTESTATION) continue;
            uint8 cnt = s.attestorCount[dealId][i];
            for (uint8 j = 0; j < cnt; j++) {
                address att = s.attestors[dealId][i][j];
                if (!s.hasAttested[dealId][i][att]) continue;
                bool dup = false;
                for (uint8 pi = 0; pi < i && !dup; pi++) {
                    if (s.milestones[dealId][pi].condition != IWaybillEscrow.ReleaseCondition.ATTESTATION) continue;
                    uint8 pc = s.attestorCount[dealId][pi];
                    for (uint8 pj = 0; pj < pc; pj++) {
                        if (s.attestors[dealId][pi][pj] == att && s.hasAttested[dealId][pi][att]) {
                            dup = true; break;
                        }
                    }
                }
                if (!dup) {
                    // H-1: registry must never block money — absorb any revert
                    try IAttestorRegistry(registry_).recordOutcome(att, IAttestorRegistry.OutcomeKind.Attested) {}
                    catch { emit IWaybillEscrow.RegistryWriteFailed(dealId, att); }
                }
            }
        }
    }

    // -------------------------------------------------------------------------
    // Storage accessor
    // -------------------------------------------------------------------------

    bytes32 private constant _LAYOUT_SLOT =
        0xb4fa23afe5bab73bfce64e08dd9c3fa4b4e0e6d3c41b48c5af5ed2ffc4d84e00;

    function _layout() private pure returns (WaybillStorage.Layout storage l) {
        bytes32 slot = _LAYOUT_SLOT;
        assembly { l.slot := slot }
    }
}
