// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20}          from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20}       from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IWaybillEscrow}  from "../../interfaces/IWaybillEscrow.sol";
import {WaybillStorage}  from "../../core/WaybillStorage.sol";
import {ClaimLogic}      from "./ClaimLogic.sol";

/// @title DisputeLogic
/// @notice External library for dispute, respondToDispute, resolve, resolveSplit,
///         applyDefault, and all address-change delay functions (03d).
library DisputeLogic {
    using SafeERC20 for IERC20;

    // -------------------------------------------------------------------------
    // dispute
    // -------------------------------------------------------------------------

    function executeDispute(uint256 dealId, uint8 milestoneIndex, bytes32 evidenceHash) external {
        WaybillStorage.Layout storage s = _layout();
        IWaybillEscrow.Deal storage deal = s.deals[dealId];
        if (deal.state != IWaybillEscrow.DealState.FUNDED)    revert IWaybillEscrow.InvalidDealState();
        if (milestoneIndex >= deal.milestoneCount)             revert IWaybillEscrow.InvalidMilestone();

        IWaybillEscrow.Milestone storage ms = s.milestones[dealId][milestoneIndex];
        _markOverdueIfNeeded(ms);

        if (msg.sender == deal.buyer) {
            if (ms.state != IWaybillEscrow.MilestoneState.IN_REVIEW) revert IWaybillEscrow.BuyerDisputeNotInReview();
            ms.buyerRaisedDispute = true;
        } else if (msg.sender == deal.supplier) {
            if (ms.state != IWaybillEscrow.MilestoneState.OVERDUE)   revert IWaybillEscrow.SupplierDisputeNotOverdue();
            if (block.timestamp > _graceEnd(ms))                      revert IWaybillEscrow.GraceExpired();
            ms.buyerRaisedDispute = false;
        } else {
            revert IWaybillEscrow.NotParticipant();
        }

        uint64 responseDeadline_ = uint64(block.timestamp) + uint64(deal.responsePeriodHours) * 1 hours;

        ms.state               = IWaybillEscrow.MilestoneState.DISPUTED;
        ms.disputed            = true;
        ms.disputeRaiser       = msg.sender;
        ms.disputeTime         = uint64(block.timestamp);
        ms.disputeEvidenceHash = evidenceHash;
        ms.responseDeadline    = responseDeadline_;
        // (04d) arbiter window starts after the response window, not from dispute time
        ms.arbiterDeadline     = responseDeadline_ + uint64(deal.arbiterDeadlineHours) * 1 hours;

        emit IWaybillEscrow.DisputeRaised(dealId, milestoneIndex, msg.sender, evidenceHash);
    }

    // -------------------------------------------------------------------------
    // respondToDispute
    // -------------------------------------------------------------------------

    function executeRespondToDispute(uint256 dealId, uint8 milestoneIndex, bytes32 evidenceHash) external {
        WaybillStorage.Layout storage s = _layout();
        IWaybillEscrow.Deal storage deal = s.deals[dealId];
        if (deal.state != IWaybillEscrow.DealState.FUNDED)    revert IWaybillEscrow.InvalidDealState();
        if (milestoneIndex >= deal.milestoneCount)             revert IWaybillEscrow.InvalidMilestone();

        IWaybillEscrow.Milestone storage ms = s.milestones[dealId][milestoneIndex];
        if (ms.state != IWaybillEscrow.MilestoneState.DISPUTED) revert IWaybillEscrow.NotDisputed();
        if (block.timestamp > ms.responseDeadline)              revert IWaybillEscrow.ResponseWindowClosed();
        if (ms.responseSubmitted)                               revert IWaybillEscrow.ResponseAlreadySubmitted();

        bool isBuyer    = (msg.sender == deal.buyer);
        bool isSupplier = (msg.sender == deal.supplier);
        if (!isBuyer && !isSupplier)          revert IWaybillEscrow.NotParticipant();
        if (msg.sender == ms.disputeRaiser)   revert IWaybillEscrow.NotDisputeResponder();

        ms.responseSubmitted = true;
        ms.responseHash      = evidenceHash;
        // (31.7) Early resolve: once the counterparty has responded the arbiter may decide
        // immediately, so the arbiter window is re-anchored to the response time. This can only
        // shorten the deadline (response happens at or before responseDeadline), never extend it.
        ms.arbiterDeadline   = uint64(block.timestamp) + uint64(deal.arbiterDeadlineHours) * 1 hours;

        emit IWaybillEscrow.DisputeResponseAdded(dealId, milestoneIndex, msg.sender, evidenceHash);
    }

    // -------------------------------------------------------------------------
    // resolve / resolveSplit
    // -------------------------------------------------------------------------

    function executeResolve(
        address usdc_,
        address registry_,
        uint256 dealId,
        uint8   milestoneIndex,
        bool    toSupplier
    ) external {
        _resolveSplitInternal(usdc_, registry_, dealId, milestoneIndex, toSupplier ? 10_000 : 0);
    }

    function executeResolveSplit(
        address usdc_,
        address registry_,
        uint256 dealId,
        uint8   milestoneIndex,
        uint16  supplierBps
    ) external {
        _resolveSplitInternal(usdc_, registry_, dealId, milestoneIndex, supplierBps);
    }

    // -------------------------------------------------------------------------
    // applyDefault
    // -------------------------------------------------------------------------

    function executeApplyDefault(
        address usdc_,
        address registry_,
        uint256 dealId,
        uint8   milestoneIndex
    ) external {
        WaybillStorage.Layout storage s = _layout();
        IWaybillEscrow.Deal storage deal = s.deals[dealId];
        if (deal.state != IWaybillEscrow.DealState.FUNDED)    revert IWaybillEscrow.InvalidDealState();
        if (milestoneIndex >= deal.milestoneCount)             revert IWaybillEscrow.InvalidMilestone();

        IWaybillEscrow.Milestone storage ms = s.milestones[dealId][milestoneIndex];
        _markOverdueIfNeeded(ms);

        if (ms.state == IWaybillEscrow.MilestoneState.DISPUTED) {
            if (block.timestamp <= ms.arbiterDeadline) revert IWaybillEscrow.ArbiterDeadlineActive();
            bool toSupplier = !ms.buyerRaisedDispute;
            ms.state    = IWaybillEscrow.MilestoneState.RESOLVED;
            ms.disputed = false;

            // (04c) Arbiter missed deadline → no timely resolve → refund buyer exactly once
            _refundArbiterFee(s, usdc_, dealId, deal);

            if (toSupplier) {
                bool paid = _payAndSettle(s, usdc_, registry_, dealId, milestoneIndex, true);
                emit IWaybillEscrow.DefaultApplied(dealId, milestoneIndex, true);
                if (!paid) return;
            } else {
                _refundAndSettle(s, usdc_, registry_, dealId, milestoneIndex);
                emit IWaybillEscrow.DefaultApplied(dealId, milestoneIndex, false);
            }
            _settle(s, usdc_, registry_, dealId);
            return;
        }

        if (ms.state == IWaybillEscrow.MilestoneState.OVERDUE) {
            if (block.timestamp <= _graceEnd(ms)) revert IWaybillEscrow.GraceActive();
            if (ms.disputed)                       revert IWaybillEscrow.Disputed();
            ms.state = IWaybillEscrow.MilestoneState.REFUNDABLE;
            emit IWaybillEscrow.MilestoneRefundable(dealId, milestoneIndex);
            return;
        }

        revert IWaybillEscrow.NoDefaultPath();
    }

    // -------------------------------------------------------------------------
    // (04d) appendDisputeEvidence
    // -------------------------------------------------------------------------

    function executeAppendDisputeEvidence(
        uint256 dealId,
        uint8   milestoneIndex,
        bytes32 evidenceHash
    ) external {
        WaybillStorage.Layout storage s = _layout();
        IWaybillEscrow.Deal storage deal = s.deals[dealId];
        if (deal.state != IWaybillEscrow.DealState.FUNDED)        revert IWaybillEscrow.InvalidDealState();
        if (milestoneIndex >= deal.milestoneCount)                 revert IWaybillEscrow.InvalidMilestone();
        if (evidenceHash == bytes32(0))                            revert IWaybillEscrow.EvidenceHashZero();

        IWaybillEscrow.Milestone storage ms = s.milestones[dealId][milestoneIndex];
        if (ms.state != IWaybillEscrow.MilestoneState.DISPUTED)   revert IWaybillEscrow.NotDisputed();
        if (block.timestamp > ms.arbiterDeadline)                  revert IWaybillEscrow.ArbiterDeadlinePassed();

        bool isBuyer    = (msg.sender == deal.buyer);
        bool isSupplier = (msg.sender == deal.supplier);
        if (!isBuyer && !isSupplier)                               revert IWaybillEscrow.NotParticipant();

        uint256 idx = s.disputeEvidence[dealId][milestoneIndex].length;
        s.disputeEvidence[dealId][milestoneIndex].push(evidenceHash);

        emit IWaybillEscrow.DisputeEvidenceAppended(dealId, milestoneIndex, msg.sender, evidenceHash, idx);
    }

    // -------------------------------------------------------------------------
    // (04d) withdrawDispute
    // -------------------------------------------------------------------------

    function executeWithdrawDispute(uint256 dealId, uint8 milestoneIndex) external {
        WaybillStorage.Layout storage s = _layout();
        IWaybillEscrow.Deal storage deal = s.deals[dealId];
        if (deal.buyer == address(0))                              revert IWaybillEscrow.DealMissing();
        if (milestoneIndex >= deal.milestoneCount)                 revert IWaybillEscrow.InvalidMilestone();
        if (msg.sender != deal.buyer)                              revert IWaybillEscrow.NotBuyer();

        IWaybillEscrow.Milestone storage ms = s.milestones[dealId][milestoneIndex];
        // Check milestone state BEFORE deal state so post-default calls get DisputeAlreadyWithdrawn
        if (ms.state != IWaybillEscrow.MilestoneState.DISPUTED)   revert IWaybillEscrow.DisputeAlreadyWithdrawn();
        if (!ms.buyerRaisedDispute)                                revert IWaybillEscrow.NotBuyerRaisedDispute();
        // Only enforce FUNDED if we would actually mutate state (milestone IS disputed here)
        if (deal.state != IWaybillEscrow.DealState.FUNDED)        revert IWaybillEscrow.InvalidDealState();

        // Reset to CLAIMABLE; clear all dispute tracking fields. No money moves, no locked change.
        ms.state               = IWaybillEscrow.MilestoneState.CLAIMABLE;
        ms.disputed            = false;
        ms.buyerRaisedDispute  = false;
        ms.disputeRaiser       = address(0);
        ms.disputeTime         = 0;
        ms.disputeEvidenceHash = bytes32(0);
        ms.responseDeadline    = 0;
        ms.responseSubmitted   = false;
        ms.responseHash        = bytes32(0);
        // arbiterDeadline is zeroed so a future re-dispute gets a fresh value
        ms.arbiterDeadline     = 0;

        emit IWaybillEscrow.DisputeWithdrawn(dealId, milestoneIndex, msg.sender);
    }

    // -------------------------------------------------------------------------
    // Address-change delay (03d)
    // -------------------------------------------------------------------------

    function executeProposePayout(uint256 dealId, address newAddr) external {
        WaybillStorage.Layout storage s = _layout();
        IWaybillEscrow.Deal storage deal = s.deals[dealId];
        if (deal.buyer == address(0))                   revert IWaybillEscrow.DealMissing();
        if (deal.state != IWaybillEscrow.DealState.FUNDED) revert IWaybillEscrow.InvalidDealState();
        if (msg.sender != deal.supplier)                revert IWaybillEscrow.NotSupplierForPayout();
        if (newAddr == address(0))                      revert IWaybillEscrow.ZeroAddressProposal();
        address old = deal.supplierPayout;
        uint64 eta = uint64(block.timestamp) + 48 hours;
        s.pendingPayout[dealId] = IWaybillEscrow.PendingAddressChange({proposed: newAddr, eta: eta});
        emit IWaybillEscrow.PayoutChangeProposed(dealId, old, newAddr, eta);
    }

    function executeRejectPayoutChange(uint256 dealId) external {
        WaybillStorage.Layout storage s = _layout();
        IWaybillEscrow.Deal storage deal = s.deals[dealId];
        if (deal.buyer == address(0))          revert IWaybillEscrow.DealMissing();
        if (msg.sender != deal.buyer)          revert IWaybillEscrow.NotBuyerForPayout();
        IWaybillEscrow.PendingAddressChange storage p = s.pendingPayout[dealId];
        if (p.proposed == address(0))          revert IWaybillEscrow.NoPendingChange();
        address rejected = p.proposed;
        delete s.pendingPayout[dealId];
        emit IWaybillEscrow.PayoutChangeRejected(dealId, rejected);
    }

    function executeApplyPayoutChange(uint256 dealId) external {
        WaybillStorage.Layout storage s = _layout();
        IWaybillEscrow.Deal storage deal = s.deals[dealId];
        if (deal.buyer == address(0))          revert IWaybillEscrow.DealMissing();
        IWaybillEscrow.PendingAddressChange storage p = s.pendingPayout[dealId];
        if (p.proposed == address(0))          revert IWaybillEscrow.NoPendingChange();
        if (block.timestamp < p.eta)           revert IWaybillEscrow.ChangeDelayActive();
        address old = deal.supplierPayout;
        address newAddr = p.proposed;
        deal.supplierPayout = newAddr;
        delete s.pendingPayout[dealId];
        emit IWaybillEscrow.PayoutChangeApplied(dealId, old, newAddr);
    }

    function executeProposeRefundAddress(uint256 dealId, address newAddr) external {
        WaybillStorage.Layout storage s = _layout();
        IWaybillEscrow.Deal storage deal = s.deals[dealId];
        if (deal.buyer == address(0))      revert IWaybillEscrow.DealMissing();
        // H-04c-2: allow address change on a SETTLED deal if there is a pending arbiter-fee refund.
        bool funded  = (deal.state == IWaybillEscrow.DealState.FUNDED);
        bool settled = (deal.state == IWaybillEscrow.DealState.SETTLED)
                       && (s.arbiterFeeRefundPending[dealId] > 0);
        if (!funded && !settled)           revert IWaybillEscrow.InvalidDealState();
        if (msg.sender != deal.buyer)      revert IWaybillEscrow.NotBuyerForRefund();
        if (newAddr == address(0))                         revert IWaybillEscrow.ZeroAddressProposal();
        address old = deal.buyerRefund;
        uint64 eta = uint64(block.timestamp) + 48 hours;
        s.pendingRefund[dealId] = IWaybillEscrow.PendingAddressChange({proposed: newAddr, eta: eta});
        emit IWaybillEscrow.RefundChangeProposed(dealId, old, newAddr, eta);
    }

    function executeRejectRefundChange(uint256 dealId) external {
        WaybillStorage.Layout storage s = _layout();
        IWaybillEscrow.Deal storage deal = s.deals[dealId];
        if (deal.buyer == address(0))          revert IWaybillEscrow.DealMissing();
        if (msg.sender != deal.supplier)       revert IWaybillEscrow.NotSupplierForRefund();
        IWaybillEscrow.PendingAddressChange storage p = s.pendingRefund[dealId];
        if (p.proposed == address(0))          revert IWaybillEscrow.NoPendingChange();
        address rejected = p.proposed;
        delete s.pendingRefund[dealId];
        emit IWaybillEscrow.RefundChangeRejected(dealId, rejected);
    }

    function executeApplyRefundChange(uint256 dealId) external {
        WaybillStorage.Layout storage s = _layout();
        IWaybillEscrow.Deal storage deal = s.deals[dealId];
        if (deal.buyer == address(0))          revert IWaybillEscrow.DealMissing();
        IWaybillEscrow.PendingAddressChange storage p = s.pendingRefund[dealId];
        if (p.proposed == address(0))          revert IWaybillEscrow.NoPendingChange();
        if (block.timestamp < p.eta)           revert IWaybillEscrow.ChangeDelayActive();
        address old = deal.buyerRefund;
        address newAddr = p.proposed;
        deal.buyerRefund = newAddr;
        delete s.pendingRefund[dealId];
        emit IWaybillEscrow.RefundChangeApplied(dealId, old, newAddr);
    }

    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------

    // -------------------------------------------------------------------------
    // (04h) Panel vote
    // -------------------------------------------------------------------------

    /// @notice Cast a 2-of-3 panel vote on a disputed milestone.
    ///         vote encoding: 1=toBuyer, 2=toSupplier, 4..10002=split(supplierBps = vote-3).
    ///         Values 0 (unvoted sentinel) and 3 (reserved gap) are invalid.
    ///         When two votes match the outcome executes atomically; single-arbiter deals revert.
    function executeCastPanelVote(
        address usdc_,
        address registry_,
        uint256 dealId,
        uint8   milestoneIndex,
        uint32  vote
    ) external {
        WaybillStorage.Layout storage s = _layout();
        IWaybillEscrow.Deal storage deal = s.deals[dealId];

        // Validate encoding first (cheap)
        if (vote == 0 || vote == 3 || vote > 10_003) revert IWaybillEscrow.InvalidVoteEncoding();

        if (deal.state != IWaybillEscrow.DealState.FUNDED) revert IWaybillEscrow.InvalidDealState();
        if (milestoneIndex >= deal.milestoneCount)          revert IWaybillEscrow.InvalidMilestone();

        // Require panel deal
        if (s.panelMembers[dealId][0] == address(0)) revert IWaybillEscrow.IsPanelDeal();

        // Verify caller is a panel member
        uint8 callerIdx = type(uint8).max;
        for (uint8 k = 0; k < 3; k++) {
            if (s.panelMembers[dealId][k] == msg.sender) { callerIdx = k; break; }
        }
        if (callerIdx == type(uint8).max) revert IWaybillEscrow.NotPanelMember();

        IWaybillEscrow.Milestone storage ms = s.milestones[dealId][milestoneIndex];
        if (ms.state != IWaybillEscrow.MilestoneState.DISPUTED) revert IWaybillEscrow.VoteAfterResolution();
        // (31.7) Decisions open early once the counterparty has responded; otherwise after the window.
        if (!ms.responseSubmitted && block.timestamp <= ms.responseDeadline) revert IWaybillEscrow.ResponseWindowOpen();
        if (block.timestamp > ms.arbiterDeadline)                revert IWaybillEscrow.ArbiterDeadlinePassed();

        // Reject duplicate votes
        if (s.panelVotes[dealId][milestoneIndex][msg.sender] != 0) revert IWaybillEscrow.AlreadyVoted();

        // Record vote
        s.panelVotes[dealId][milestoneIndex][msg.sender] = vote;
        emit IWaybillEscrow.PanelVoteCast(dealId, milestoneIndex, msg.sender, vote);

        // Check for 2-of-3 match: count how many votes match this one
        uint8 matches = 1; // this vote matches itself
        for (uint8 k = 0; k < 3; k++) {
            if (s.panelMembers[dealId][k] == msg.sender) continue;
            uint32 other = s.panelVotes[dealId][milestoneIndex][s.panelMembers[dealId][k]];
            if (other == vote) { matches += 1; break; } // 2 matching = execute (we need exactly 2)
        }

        if (matches < 2) return; // no consensus yet — nothing more to do

        // 2-of-3 consensus reached — execute resolution exactly once
        emit IWaybillEscrow.PanelResolved(dealId, milestoneIndex, vote);

        ms.state    = IWaybillEscrow.MilestoneState.RESOLVED;
        ms.disputed = false;

        // (04c) Credit arbiter fee. For panel deals, deal.arbiter == panel[0].
        // The fee goes to deal.arbiter's feeBalance. This is intentional — the
        // panel leader collects the fee and distributes off-chain if desired.
        _creditArbiterFee(s, usdc_, dealId, deal);

        uint16 supplierBps;
        if (vote == 1) {
            // toBuyer
            supplierBps = 0;
        } else if (vote == 2) {
            // toSupplier
            supplierBps = 10_000;
        } else {
            // split: supplierBps = vote - 3
            supplierBps = uint16(vote - 3);
        }

        if (supplierBps == 10_000) {
            bool paid = _payAndSettle(s, usdc_, registry_, dealId, milestoneIndex, false);
            emit IWaybillEscrow.DisputeResolved(dealId, milestoneIndex, msg.sender, true);
            if (!paid) return;
        } else if (supplierBps == 0) {
            _refundAndSettle(s, usdc_, registry_, dealId, milestoneIndex);
            emit IWaybillEscrow.DisputeResolved(dealId, milestoneIndex, msg.sender, false);
        } else {
            _executeSplitResolution(s, usdc_, registry_, dealId, milestoneIndex, deal, ms, supplierBps);
        }

        _settle(s, usdc_, registry_, dealId);
    }

    function _resolveSplitInternal(
        address usdc_,
        address registry_,
        uint256 dealId,
        uint8   milestoneIndex,
        uint16  supplierBps
    ) private {
        WaybillStorage.Layout storage s = _layout();
        IWaybillEscrow.Deal storage deal = s.deals[dealId];
        if (deal.state != IWaybillEscrow.DealState.FUNDED)    revert IWaybillEscrow.InvalidDealState();
        // (04h) Panel deals must use castPanelVote; single-arbiter deals use resolve/resolveSplit.
        if (s.panelMembers[dealId][0] != address(0))           revert IWaybillEscrow.NotSingleArbiter();
        if (msg.sender != deal.arbiter)                        revert IWaybillEscrow.NotArbiter();
        if (milestoneIndex >= deal.milestoneCount)             revert IWaybillEscrow.InvalidMilestone();
        if (supplierBps > 10_000)                              revert IWaybillEscrow.InvalidSplitBps();

        IWaybillEscrow.Milestone storage ms = s.milestones[dealId][milestoneIndex];
        if (ms.state != IWaybillEscrow.MilestoneState.DISPUTED) revert IWaybillEscrow.NotDisputed();
        // (31.7) Decisions open early once the counterparty has responded; otherwise after the window.
        if (!ms.responseSubmitted && block.timestamp <= ms.responseDeadline) revert IWaybillEscrow.ResponseWindowOpen();
        if (block.timestamp > ms.arbiterDeadline)               revert IWaybillEscrow.ArbiterDeadlinePassed();

        ms.state    = IWaybillEscrow.MilestoneState.RESOLVED;
        ms.disputed = false;

        // (04c) Credit arbiter fee exactly once on the first timely resolve.
        _creditArbiterFee(s, usdc_, dealId, deal);

        if (supplierBps == 10_000) {
            bool paid = _payAndSettle(s, usdc_, registry_, dealId, milestoneIndex, false);
            emit IWaybillEscrow.DisputeResolved(dealId, milestoneIndex, msg.sender, true);
            if (!paid) return;
        } else if (supplierBps == 0) {
            _refundAndSettle(s, usdc_, registry_, dealId, milestoneIndex);
            emit IWaybillEscrow.DisputeResolved(dealId, milestoneIndex, msg.sender, false);
        } else {
            _executeSplitResolution(s, usdc_, registry_, dealId, milestoneIndex, deal, ms, supplierBps);
        }

        _settle(s, usdc_, registry_, dealId);
    }

    /// @dev Shared partial-split execution (used by both single-arbiter and panel paths).
    ///      Caller must have already set ms.state = RESOLVED, ms.disputed = false, and credited arbiter fee.
    ///      Does NOT call _settle — caller is responsible.
    function _executeSplitResolution(
        WaybillStorage.Layout storage s,
        address usdc_,
        address registry_,
        uint256 dealId,
        uint8   milestoneIndex,
        IWaybillEscrow.Deal storage deal,
        IWaybillEscrow.Milestone storage ms,
        uint16  supplierBps
    ) private {
        // Partial split — atomic: both transfers revert together
        uint256 trancheAmount = ClaimLogic._trancheAmount(s, dealId, milestoneIndex);
        uint256 fee           = s.trancheFees[dealId][milestoneIndex];
        uint256 bpf           = s.buyerPaidFee[dealId][milestoneIndex];

        uint256 principalSupplier = (trancheAmount * supplierBps) / 10_000;
        uint256 principalBuyer    = trancheAmount - principalSupplier;
        uint256 feeSupplier       = (fee * supplierBps) / 10_000;
        uint256 supplierDeducted  = fee - bpf;

        s.currentLocked -= (trancheAmount + bpf);
        address dealTreasury = deal.protocolTreasury;

        if (ms.condition == IWaybillEscrow.ReleaseCondition.ATTESTATION && ms.attested) {
            uint256 treasuryShare = (feeSupplier * 60) / 100;
            uint256 attestorShare = feeSupplier - treasuryShare;
            s.feeBalances[dealTreasury] += treasuryShare;
            uint8 totalAtt = s.attestorCount[dealId][milestoneIndex];
            _creditAttestorFees(s, dealId, milestoneIndex, totalAtt, ms.attestCount, attestorShare, true);
        } else {
            s.feeBalances[dealTreasury] += feeSupplier;
        }

        uint256 supplierDeductedShare = (supplierDeducted * supplierBps) / 10_000;
        uint256 bpfBuyerShare         = (bpf * (10_000 - supplierBps)) / 10_000;
        uint256 supplierOut = principalSupplier - supplierDeductedShare;
        uint256 buyerOut    = principalBuyer + bpfBuyerShare;

        if (!_tryTransfer(usdc_, deal.supplierPayout, supplierOut))
            revert IWaybillEscrow.SplitTransferFailed();
        if (!_tryTransfer(usdc_, deal.buyerRefund, buyerOut))
            revert IWaybillEscrow.SplitTransferFailed();

        emit IWaybillEscrow.TrancheSplit(dealId, milestoneIndex, supplierBps, supplierOut, principalBuyer);
    }

    function _payAndSettle(
        WaybillStorage.Layout storage s,
        address usdc_,
        address registry_,
        uint256 dealId,
        uint8   milestoneIndex,
        bool    alreadyResolvedState
    ) private returns (bool) {
        // Note: alreadyResolvedState flag is unused in current impl but kept for clarity
        IWaybillEscrow.Deal storage deal = s.deals[dealId];
        IWaybillEscrow.Milestone storage ms = s.milestones[dealId][milestoneIndex];
        address dealTreasury = deal.protocolTreasury;

        uint256 trancheAmount = ClaimLogic._trancheAmount(s, dealId, milestoneIndex);
        uint256 fee = s.trancheFees[dealId][milestoneIndex];
        // (04g) currentLocked tracks tranche + buyerPaidFee; supplier gets tranche - supplierDeducted
        uint256 bpf = s.buyerPaidFee[dealId][milestoneIndex];

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

        uint256 supplierDeducted = fee - bpf;
        uint256 supplierPayout = trancheAmount - supplierDeducted;
        bool ok = _tryTransfer(usdc_, deal.supplierPayout, supplierPayout);

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

    function _refundAndSettle(
        WaybillStorage.Layout storage s,
        address usdc_,
        address registry_,
        uint256 dealId,
        uint8   milestoneIndex
    ) private {
        IWaybillEscrow.Deal storage deal = s.deals[dealId];
        IWaybillEscrow.Milestone storage ms = s.milestones[dealId][milestoneIndex];
        uint256 trancheAmount = ClaimLogic._trancheAmount(s, dealId, milestoneIndex);
        // (04g) Buyer only gets back what they deposited: tranche + buyerPaidFee.
        uint256 bpf = s.buyerPaidFee[dealId][milestoneIndex];
        uint256 payout = trancheAmount + bpf;

        s.currentLocked -= payout;

        bool ok = _tryTransfer(usdc_, deal.buyerRefund, payout);

        if (!ok) {
            s.currentLocked += payout;
            ms.state = IWaybillEscrow.MilestoneState.REFUNDABLE;
            emit IWaybillEscrow.RefundFailed(dealId, milestoneIndex, deal.buyerRefund, payout);
            return;
        }
        emit IWaybillEscrow.TrancheRefunded(dealId, milestoneIndex, deal.buyerRefund, trancheAmount, bpf);
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

    /// @dev Non-reverting ERC-20 transfer: handles tokens that return nothing and tokens that return bool.
    function _tryTransfer(address token, address to, uint256 amount) private returns (bool) {
        (bool success, bytes memory ret) = token.call(
            abi.encodeWithSignature("transfer(address,uint256)", to, amount)
        );
        return success && (ret.length == 0 || abi.decode(ret, (bool)));
    }

    // -------------------------------------------------------------------------
    // (04c) Arbiter fee helpers
    // -------------------------------------------------------------------------

    /// @dev Credits the deal's arbiter fee to the arbiter's withdrawable balance exactly once.
    ///      H-04c-3: writes ONLY to arbiterFeeClaimable[dealId] and arbiterFeeBalances[arbiter].
    ///      feeBalances is NOT touched, so withdrawFees() can never consume this claim.
    ///      currentLocked is NOT decremented here — it decrements when the arbiter pulls the fee
    ///      (executeWithdrawArbiterFee) so the escrow balance invariant holds at all times.
    function _creditArbiterFee(
        WaybillStorage.Layout storage s,
        address usdc_,
        uint256 dealId,
        IWaybillEscrow.Deal storage deal
    ) private {
        uint256 fee = deal.arbiterFee;
        if (fee == 0 || s.arbiterFeePaid[dealId]) return;
        s.arbiterFeePaid[dealId]          = true;
        s.arbiterFeeClaimable[dealId]     = fee;   // H-04c-1: per-deal isolation
        s.arbiterFeeBalances[deal.arbiter] += fee;  // H-04c-3: separate from feeBalances
        // currentLocked stays unchanged — fee remains locked until arbiter pulls
        emit IWaybillEscrow.ArbiterFeeCredited(dealId, deal.arbiter, fee);
    }

    /// @dev Refunds the arbiter fee to the buyer exactly once (default / no-dispute settle / cancel).
    ///      H-04c-2: on transfer failure, stores arbiterFeeRefundPending for retry after address change.
    ///      H-04c-3 (pending accounting): currentLocked is decremented ONLY on successful delivery.
    ///      On failure the fee remains locked (currentLocked not touched) so the escrow
    ///      balance invariant holds — escrow holds the USDC and currentLocked reflects it.
    function _refundArbiterFee(
        WaybillStorage.Layout storage s,
        address usdc_,
        uint256 dealId,
        IWaybillEscrow.Deal storage deal
    ) private {
        uint256 fee = deal.arbiterFee;
        if (fee == 0 || s.arbiterFeePaid[dealId] || s.arbiterFeeRefunded[dealId]) return;
        // Skip if already pending from a prior failed attempt — fee is still locked, just retryable.
        if (s.arbiterFeeRefundPending[dealId] > 0) return;
        (bool ok, bytes memory ret) = usdc_.call(
            abi.encodeWithSignature("transfer(address,uint256)", deal.buyerRefund, fee)
        );
        bool success = ok && (ret.length == 0 || abi.decode(ret, (bool)));
        if (!success) {
            // H-04c-2 + H-04c-3: mark retryable; currentLocked NOT decremented — fee stays locked.
            s.arbiterFeeRefundPending[dealId] = fee;
            emit IWaybillEscrow.ArbiterFeeRefundPending(dealId, deal.buyerRefund, fee);
            return;
        }
        s.currentLocked -= fee;   // delivered — now safe to release from locked accounting
        s.arbiterFeeRefunded[dealId] = true;
        emit IWaybillEscrow.ArbiterFeeRefunded(dealId, deal.buyerRefund, fee);
    }

    /// @notice (H-04c-2) Retry a failed arbiter-fee refund after a delayed refund-address change.
    ///         Anyone may call; transfer goes to current deal.buyerRefund.
    ///         Reverts if no pending refund or transfer still fails (buyer must fix address first).
    function executeRetryArbiterFeeRefund(address usdc_, uint256 dealId) external {
        WaybillStorage.Layout storage s = _layout();
        IWaybillEscrow.Deal storage deal = s.deals[dealId];
        if (deal.buyer == address(0))              revert IWaybillEscrow.DealMissing();
        uint256 pending = s.arbiterFeeRefundPending[dealId];
        if (pending == 0)                          revert IWaybillEscrow.NoFees();
        s.arbiterFeeRefundPending[dealId] = 0;
        (bool ok, bytes memory ret) = usdc_.call(
            abi.encodeWithSignature("transfer(address,uint256)", deal.buyerRefund, pending)
        );
        bool success = ok && (ret.length == 0 || abi.decode(ret, (bool)));
        if (!success) {
            // Still blocked — restore pending; currentLocked unchanged (still locked).
            s.arbiterFeeRefundPending[dealId] = pending;
            revert IWaybillEscrow.RefundTransferFailed();
        }
        s.currentLocked -= pending;   // H-04c-3: only decrement now that delivery succeeded
        s.arbiterFeeRefunded[dealId] = true;
        emit IWaybillEscrow.ArbiterFeeRefunded(dealId, deal.buyerRefund, pending);
    }

    /// @notice (04c) Pull pending arbiter fee for a specific deal.
    ///         H-04c-1: reads per-deal claimable amount.
    ///         H-04c-3: decrements arbiterFeeBalances (separate from feeBalances) and currentLocked.
    ///         Cannot drain protocol/attestor fee balances or another deal's fee.
    function executeWithdrawArbiterFee(address usdc_, uint256 dealId) external {
        WaybillStorage.Layout storage s = _layout();
        IWaybillEscrow.Deal storage deal = s.deals[dealId];
        if (deal.buyer == address(0))      revert IWaybillEscrow.DealMissing();
        if (msg.sender != deal.arbiter)    revert IWaybillEscrow.NotArbiter();
        uint256 amount = s.arbiterFeeClaimable[dealId];
        if (amount == 0)                   revert IWaybillEscrow.NoFees();
        s.arbiterFeeClaimable[dealId]        = 0;
        s.arbiterFeeBalances[deal.arbiter]  -= amount;   // H-04c-3: separate ledger
        s.currentLocked                     -= amount;   // now safe to release
        IERC20(usdc_).safeTransfer(deal.arbiter, amount);
        emit IWaybillEscrow.FeesWithdrawn(deal.arbiter, amount);
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

    function _graceEnd(IWaybillEscrow.Milestone storage ms) private view returns (uint64) {
        return ms.deadline + uint64(ms.gracePeriod) * 1 hours;
    }

    function _settle(
        WaybillStorage.Layout storage s,
        address usdc_,
        address registry_,
        uint256 dealId
    ) private {
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
        }
        deal.state   = IWaybillEscrow.DealState.SETTLED;
        deal.settled = true;
        emit IWaybillEscrow.DealSettled(dealId);

        // (04c) If no dispute ever occurred (or fee not yet moved), refund arbiter fee to buyer.
        _refundArbiterFee(s, usdc_, dealId, deal);

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

// forward-declare to avoid circular import
interface IAttestorRegistry {
    enum OutcomeKind { Attested, Slashed }
    function recordOutcome(address attestor, OutcomeKind kind) external;
}
