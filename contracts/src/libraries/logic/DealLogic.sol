// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20}             from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20}          from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IWaybillEscrow}     from "../../interfaces/IWaybillEscrow.sol";
import {IArbiterList}       from "../../interfaces/IArbiterList.sol";
import {IAttestorRegistry}  from "../../interfaces/IAttestorRegistry.sol";
import {WaybillStorage}     from "../../core/WaybillStorage.sol";

/// @title DealLogic
/// @notice External library handling deal creation, all accept functions, fund,
///         and cancelUnaccepted.  Called via DELEGATECALL from WaybillEscrow so
///         it runs in the escrow's storage context.
library DealLogic {
    using SafeERC20 for IERC20;

    // -------------------------------------------------------------------------
    // Helpers (pure — inlined by compiler, zero overhead)
    // -------------------------------------------------------------------------

    function _computePrepaidFee(uint256 totalAmount, uint16 feeBps) private pure returns (uint256) {
        return (totalAmount * feeBps + 9_999) / 10_000;
    }

    function _hoursToSeconds(uint32 h) private pure returns (uint64) {
        return uint64(h) * 1 hours;
    }

    function _isFullyAccepted(
        WaybillStorage.Layout storage s,
        uint256 dealId
    ) internal view returns (bool) {
        IWaybillEscrow.Deal storage deal = s.deals[dealId];
        if (deal.supplier == address(0) || deal.supplierPayout == address(0)) return false;
        if (!deal.arbiterAccepted) return false;
        for (uint8 i = 0; i < deal.milestoneCount; i++) {
            IWaybillEscrow.Milestone storage ms = s.milestones[dealId][i];
            if (ms.condition == IWaybillEscrow.ReleaseCondition.ATTESTATION && !ms.attestorAccepted) {
                return false;
            }
        }
        return true;
    }

    // -------------------------------------------------------------------------
    // createDeal
    // -------------------------------------------------------------------------

    /// @notice Validates inputs, writes deal + milestones, emits DealCreated.
    ///         Does NOT transfer USDC — that happens in executeFund.
    function executeCreateDeal(
        address usdc_,
        address pauser_,             // unused here, kept for ABI symmetry
        uint256 maxDealAmount_,
        uint256 maxLocked_,
        address arbiterList_,
        address registry_,           // (04i) AttestorRegistry for suspended-attestor check
        address treasury_,
        address supplier,
        address buyerRefund,
        address arbiter,
        uint256 totalAmount,
        uint16  feeBps,
        uint64  acceptanceDeadlineTs,
        uint32  arbiterDeadlineHours,
        IWaybillEscrow.MilestoneInput[] calldata milestoneInputs,
        bool    fundFirst,
        uint256 arbiterFee,          // (04c) fixed USDC arbiter fee; 0 = none
        IWaybillEscrow.FeePayer feePayer  // (04g) who pays the protocol fee
    ) external returns (uint256 dealId) {
        dealId = _createDealCore(usdc_, maxDealAmount_, maxLocked_, arbiterList_, registry_, treasury_,
            supplier, buyerRefund, arbiter, totalAmount, feeBps, acceptanceDeadlineTs,
            arbiterDeadlineHours, milestoneInputs, fundFirst, arbiterFee, feePayer);
    }

    /// @dev (04i) Reverts AttestorSuspended when the registry has that attestor as Suspended.
    ///      Protected by try/catch for H-1 compatibility: a non-conforming or reverting registry
    ///      (e.g. the RevertingRegistry mock in CancelUnaccepted03k) must not block deal creation.
    function _revertIfSuspended(address registry_, address att) private {
        if (registry_ == address(0)) return;
        try IAttestorRegistry(registry_).status(att) returns (IAttestorRegistry.Status st) {
            if (st == IAttestorRegistry.Status.Suspended)
                revert IWaybillEscrow.AttestorSuspended();
        } catch { /* non-conforming registry — treat as non-suspended */ }
    }

    /// @dev Internal core — shared by executeCreateDeal and executeCreateDealWithPanel.
    function _createDealCore(
        address usdc_,
        uint256 maxDealAmount_,
        uint256 maxLocked_,
        address arbiterList_,
        address registry_,      // (04i) AttestorRegistry; address(0) skips suspended check
        address treasury_,
        address supplier,
        address buyerRefund,
        address arbiter,
        uint256 totalAmount,
        uint16  feeBps,
        uint64  acceptanceDeadlineTs,
        uint32  arbiterDeadlineHours,
        IWaybillEscrow.MilestoneInput[] calldata milestoneInputs,
        bool    fundFirst,
        uint256 arbiterFee,
        IWaybillEscrow.FeePayer feePayer
    ) internal returns (uint256 dealId) {
        WaybillStorage.Layout storage s = _layout();

        if (s.newDealsPaused)                    revert IWaybillEscrow.NewDealsPausedError();
        if (supplier == address(0))              revert IWaybillEscrow.SupplierZeroAddress();
        if (buyerRefund == address(0))           revert IWaybillEscrow.BuyerRefundZeroAddress();
        if (arbiter == address(0))               revert IWaybillEscrow.ArbiterZeroAddress();
        if (!IArbiterList(arbiterList_).isAllowed(arbiter)) revert IWaybillEscrow.ArbiterNotAllowed();
        if (arbiter == msg.sender)               revert IWaybillEscrow.ArbiterIsBuyer();
        if (arbiter == supplier)                 revert IWaybillEscrow.ArbiterIsSupplier();
        if (totalAmount == 0 || totalAmount > maxDealAmount_) revert IWaybillEscrow.InvalidTotal();
        if (feeBps < s.minFeeBps || feeBps > s.maxFeeBps)    revert IWaybillEscrow.InvalidFeeBps();
        if (acceptanceDeadlineTs <= block.timestamp)          revert IWaybillEscrow.InvalidAcceptanceDeadline();
        if (arbiterDeadlineHours == 0)                        revert IWaybillEscrow.InvalidArbiterHours();
        // (04g) Validate fee-payer mode. Solidity does not bounds-check enums cast from calldata,
        //       but the compiler rejects out-of-range enum values in ABI decoding — so the guard
        //       below catches any future external cast that bypasses the Solidity ABI decoder.
        if (uint8(feePayer) > 2)                              revert IWaybillEscrow.InvalidFeePayer();

        uint256 milestoneCount = milestoneInputs.length;
        if (milestoneCount == 0 || milestoneCount > 8) revert IWaybillEscrow.InvalidMilestoneCount();

        uint256 fullFee = _computePrepaidFee(totalAmount, feeBps);
        // (04g) prepaidFee = buyer's actual protocol-fee deposit (depends on mode).
        // SupplierDeducted: buyer deposits nothing for protocol fees.
        // Split: buyer deposits half (ceil per tranche, computed below; stored in prepaidFee as sum).
        // BuyerPrepaid (default): buyer deposits the full fee.
        // NOTE: we compute the exact Split half-sum during the milestone loop below.
        // For maxLocked check we use fullFee (worst case = BuyerPrepaid) conservatively.
        if (s.currentLocked + totalAmount + fullFee + arbiterFee > maxLocked_) revert IWaybillEscrow.MaxLockedExceeded();

        dealId = s.nextDealId;
        s.nextDealId = dealId + 1;

        IWaybillEscrow.Deal storage deal = s.deals[dealId];
        deal.buyer             = msg.sender;
        deal.supplier          = supplier;
        deal.buyerRefund       = buyerRefund;
        deal.arbiter           = arbiter;
        deal.state             = IWaybillEscrow.DealState.PROPOSED;
        deal.totalAmount       = totalAmount;
        // prepaidFee is set below after the milestone loop (Split mode needs tranche-level rounding)
        deal.feeBps            = feeBps;
        deal.milestoneCount    = uint8(milestoneCount);
        deal.acceptanceDeadline = acceptanceDeadlineTs;
        deal.arbiterDeadlineHours = uint64(arbiterDeadlineHours);
        deal.responsePeriodHours  = 72;
        deal.protocolTreasury  = treasury_;  // snapshot at creation time
        deal.fundFirst         = fundFirst;
        deal.arbiterFee        = arbiterFee; // (04c) may be 0
        deal.feePayer          = feePayer;   // (04g)

        uint256 bpsSum;
        uint256 allocatedFee;        // tracks full-fee allocated to earlier milestones (for last-tranche dust)
        uint256 allocatedBuyerFee;   // tracks buyer-paid-fee allocated to earlier milestones (Split mode)
        uint8   maxAtt = 5; // MAX_ATTESTORS
        uint16  INDEPENDENT = type(uint16).max;

        for (uint8 i = 0; i < uint8(milestoneCount); i++) {
            IWaybillEscrow.MilestoneInput calldata inp = milestoneInputs[i];
            bpsSum += inp.bps;

            // ── (04f) Validate and store dependency ─────────────────────────────
            // sentinel (type(uint16).max) = independent; any other value must be < i
            if (inp.dependsOn != INDEPENDENT) {
                // self-reference, forward reference, or out-of-range all revert
                if (inp.dependsOn >= i) revert IWaybillEscrow.InvalidDependsOn();
                s.milestoneDependsOn[dealId][i] = inp.dependsOn;
            } else {
                s.milestoneDependsOn[dealId][i] = INDEPENDENT;
            }

            if (inp.condition == IWaybillEscrow.ReleaseCondition.ATTESTATION) {
                uint256 alen = inp.attestors.length;
                if (alen == 0)              revert IWaybillEscrow.AttestorRequired();
                if (alen > maxAtt)          revert IWaybillEscrow.TooManyAttestors();
                if (inp.threshold == 0 || inp.threshold > uint8(alen)) revert IWaybillEscrow.InvalidThreshold();

                for (uint8 j = 0; j < uint8(alen); j++) {
                    address att = inp.attestors[j];
                    if (att == address(0)) revert IWaybillEscrow.AttestorRequired();
                    if (att == arbiter)    revert IWaybillEscrow.AttestorIsArbiter();
                    if (att == msg.sender) revert IWaybillEscrow.AttestorIsBuyer();
                    if (att == supplier)   revert IWaybillEscrow.AttestorIsSupplier();
                    // (04i) Reject attestors with Suspended status.
                    _revertIfSuspended(registry_, att);
                    for (uint8 k = 0; k < j; k++) {
                        if (inp.attestors[k] == att) revert IWaybillEscrow.DuplicateAttestor();
                    }
                    s.attestors[dealId][i][j] = att;
                }
                s.attestorCount[dealId][i] = uint8(alen);
            } else {
                if (inp.attestors.length > 0) revert IWaybillEscrow.AttestorsNotEmpty();
                if (inp.threshold != 0)       revert IWaybillEscrow.InvalidThreshold();
            }

            IWaybillEscrow.Milestone storage ms = s.milestones[dealId][i];
            ms.bps       = inp.bps;
            ms.condition = inp.condition;
            ms.attestor  = (inp.condition == IWaybillEscrow.ReleaseCondition.ATTESTATION && inp.attestors.length > 0)
                ? inp.attestors[0] : address(0);
            ms.deadline      = inp.deadline;
            ms.gracePeriod   = inp.gracePeriod;
            ms.reviewWindow  = inp.reviewWindow;
            ms.state         = IWaybillEscrow.MilestoneState.WAITING;
            ms.threshold     = inp.threshold;

            // ── full protocol fee for this tranche (always credited to treasury/attestors) ──
            uint256 fee;
            if (i == uint8(milestoneCount) - 1) {
                fee = fullFee - allocatedFee;
            } else {
                fee = (fullFee * inp.bps) / 10_000;
                allocatedFee += fee;
            }
            s.trancheFees[dealId][i] = fee;

            // ── (04g) buyer's portion of this tranche's protocol fee ─────────────
            uint256 bpf; // buyer-paid-fee for this tranche
            if (feePayer == IWaybillEscrow.FeePayer.BuyerPrepaid) {
                bpf = fee; // buyer pays the whole fee
            } else if (feePayer == IWaybillEscrow.FeePayer.SupplierDeducted) {
                bpf = 0;   // buyer pays nothing; supplier deducted on release
            } else {
                // Split: buyer pays ceil(fee/2) for non-final tranches; last tranche absorbs dust
                if (i == uint8(milestoneCount) - 1) {
                    // last tranche: buyer's share = fullFee_half_sum - allocatedBuyerFee
                    // compute total buyer half = ceil(fullFee / 2)
                    uint256 totalBuyerHalf = (fullFee + 1) / 2;
                    bpf = totalBuyerHalf - allocatedBuyerFee;
                } else {
                    bpf = (fee + 1) / 2; // ceil(fee/2)
                    allocatedBuyerFee += bpf;
                }
            }
            s.buyerPaidFee[dealId][i] = bpf;
        }

        if (bpsSum != 10_000) revert IWaybillEscrow.InvalidBpsSum();

        // ── (04g) set deal.prepaidFee = sum of buyer-paid-fee across all tranches ──
        // BuyerPrepaid: = fullFee (unchanged from pre-04g behaviour)
        // SupplierDeducted: = 0
        // Split: = sum of bpf[i] computed above
        {
            uint256 pf;
            for (uint8 i = 0; i < uint8(milestoneCount); i++) {
                pf += s.buyerPaidFee[dealId][i];
            }
            deal.prepaidFee = pf;
        }

        emit IWaybillEscrow.DealCreated(dealId, msg.sender, supplier, arbiter, totalAmount, feeBps);
    }

    // -------------------------------------------------------------------------
    // acceptSupplier
    // -------------------------------------------------------------------------

    function executeAcceptSupplier(uint256 dealId, address payoutAddress) external {
        WaybillStorage.Layout storage s = _layout();
        IWaybillEscrow.Deal storage deal = s.deals[dealId];
        if (deal.buyer == address(0))                         revert IWaybillEscrow.DealMissing();
        bool validState = deal.state == IWaybillEscrow.DealState.PROPOSED
            || deal.state == IWaybillEscrow.DealState.ACCEPTED
            || (deal.fundFirst && deal.state == IWaybillEscrow.DealState.FUNDED);
        if (!validState)                                      revert IWaybillEscrow.InvalidDealState();
        if (block.timestamp > deal.acceptanceDeadline)        revert IWaybillEscrow.AcceptanceExpired();
        if (msg.sender != deal.supplier)                      revert IWaybillEscrow.NotSupplier();
        if (payoutAddress == address(0))                      revert IWaybillEscrow.SupplierZeroAddress();
        if (deal.supplierPayout != address(0))                revert IWaybillEscrow.AlreadyAccepted();

        deal.supplierPayout = payoutAddress;
        emit IWaybillEscrow.SupplierAccepted(dealId, msg.sender, payoutAddress);

        if (deal.state != IWaybillEscrow.DealState.FUNDED && _isFullyAccepted(s, dealId)) {
            deal.state = IWaybillEscrow.DealState.ACCEPTED;
        }
    }

    // -------------------------------------------------------------------------
    // acceptAttestor
    // -------------------------------------------------------------------------

    function executeAcceptAttestor(uint256 dealId, uint8 milestoneIndex) external {
        WaybillStorage.Layout storage s = _layout();
        IWaybillEscrow.Deal storage deal = s.deals[dealId];
        if (deal.buyer == address(0))                         revert IWaybillEscrow.DealMissing();
        bool validState = deal.state == IWaybillEscrow.DealState.PROPOSED
            || deal.state == IWaybillEscrow.DealState.ACCEPTED
            || (deal.fundFirst && deal.state == IWaybillEscrow.DealState.FUNDED);
        if (!validState)                                      revert IWaybillEscrow.InvalidDealState();
        if (block.timestamp > deal.acceptanceDeadline)        revert IWaybillEscrow.AcceptanceExpired();
        if (milestoneIndex >= deal.milestoneCount)            revert IWaybillEscrow.InvalidMilestone();

        IWaybillEscrow.Milestone storage ms = s.milestones[dealId][milestoneIndex];
        if (ms.condition != IWaybillEscrow.ReleaseCondition.ATTESTATION) revert IWaybillEscrow.NotAttestationMilestone();

        uint8 count = s.attestorCount[dealId][milestoneIndex];
        bool found;
        for (uint8 j = 0; j < count; j++) {
            if (s.attestors[dealId][milestoneIndex][j] == msg.sender) { found = true; break; }
        }
        if (!found) revert IWaybillEscrow.NotAttestor();
        if (s.attestorAccepted[dealId][milestoneIndex][msg.sender]) revert IWaybillEscrow.AttestorAlreadyAccepted();

        s.attestorAccepted[dealId][milestoneIndex][msg.sender] = true;
        s.acceptedCount[dealId][milestoneIndex] += 1;

        if (s.acceptedCount[dealId][milestoneIndex] == count) {
            ms.attestorAccepted = true;
        }
        emit IWaybillEscrow.AttestorAccepted(dealId, milestoneIndex, msg.sender);

        if (deal.state != IWaybillEscrow.DealState.FUNDED && _isFullyAccepted(s, dealId)) {
            deal.state = IWaybillEscrow.DealState.ACCEPTED;
        }
    }

    // -------------------------------------------------------------------------
    // acceptArbiter
    // -------------------------------------------------------------------------

    function executeAcceptArbiter(uint256 dealId) external {
        WaybillStorage.Layout storage s = _layout();
        IWaybillEscrow.Deal storage deal = s.deals[dealId];
        if (deal.buyer == address(0))                         revert IWaybillEscrow.DealMissing();
        bool validState = deal.state == IWaybillEscrow.DealState.PROPOSED
            || deal.state == IWaybillEscrow.DealState.ACCEPTED
            || (deal.fundFirst && deal.state == IWaybillEscrow.DealState.FUNDED);
        if (!validState)                                      revert IWaybillEscrow.InvalidDealState();
        if (block.timestamp > deal.acceptanceDeadline)        revert IWaybillEscrow.AcceptanceExpired();

        // (04h) Panel deal: deal.arbiter is address(1) sentinel; each panel member calls acceptArbiter.
        bool isPanel = (s.panelMembers[dealId][0] != address(0));
        if (isPanel) {
            // Verify caller is a panel member
            bool found;
            for (uint8 k = 0; k < 3; k++) {
                if (s.panelMembers[dealId][k] == msg.sender) { found = true; break; }
            }
            if (!found) revert IWaybillEscrow.NotPanelMember();
            if (s.panelMemberAccepted[dealId][msg.sender]) revert IWaybillEscrow.AlreadyAccepted();
            s.panelMemberAccepted[dealId][msg.sender] = true;
            s.panelAcceptCount[dealId] += 1;
            emit IWaybillEscrow.PanelMemberAccepted(dealId, msg.sender);
            if (s.panelAcceptCount[dealId] == 3) {
                deal.arbiterAccepted = true;
                emit IWaybillEscrow.ArbiterAccepted(dealId, msg.sender);
            }
        } else {
            if (msg.sender != deal.arbiter)                   revert IWaybillEscrow.NotArbiter();
            deal.arbiterAccepted = true;
            emit IWaybillEscrow.ArbiterAccepted(dealId, msg.sender);
        }

        if (deal.state != IWaybillEscrow.DealState.FUNDED && _isFullyAccepted(s, dealId)) {
            deal.state = IWaybillEscrow.DealState.ACCEPTED;
        }
    }

    // -------------------------------------------------------------------------
    // createDealWithPanel (04h)
    // -------------------------------------------------------------------------

    // ── Internal param bundle to sidestep Yul stack-depth limits ────────────
    struct _PanelParams {
        address usdc_;
        uint256 maxDealAmount_;
        uint256 maxLocked_;
        address arbiterList_;
        address registry_;   // (04i)
        address treasury_;
        address supplier;
        address buyerRefund;
        uint256 totalAmount;
        uint16  feeBps;
        uint64  acceptanceDeadlineTs;
        uint32  arbiterDeadlineHours;
        bool    fundFirst;
        uint256 arbiterFee;
        IWaybillEscrow.FeePayer feePayer;
    }

    /// @notice Creates a deal with an optional 3-member arbitration panel.
    ///         panel.length == 0: legacy single-arbiter path; arbiter is used normally.
    ///         panel.length == 3: panel deal; arbiter arg is ignored; all three panel members
    ///                           must accept before fund (unless fundFirst).
    ///         Any other panel length reverts InvalidPanelSize.
    function executeCreateDealWithPanel(
        address usdc_,
        address pauser_,
        uint256 maxDealAmount_,
        uint256 maxLocked_,
        address arbiterList_,
        address registry_,      // (04i)
        address treasury_,
        address supplier,
        address buyerRefund,
        address arbiter,        // used when panel is empty; ignored when panel.length == 3
        address[] calldata panel,
        uint256 totalAmount,
        uint16  feeBps,
        uint64  acceptanceDeadlineTs,
        uint32  arbiterDeadlineHours,
        IWaybillEscrow.MilestoneInput[] calldata milestoneInputs,
        bool    fundFirst,
        uint256 arbiterFee,
        IWaybillEscrow.FeePayer feePayer
    ) external returns (uint256 dealId) {
        // Bundle scalars into memory struct to stay within Yul stack limits.
        _PanelParams memory p = _PanelParams({
            usdc_: usdc_, maxDealAmount_: maxDealAmount_, maxLocked_: maxLocked_,
            arbiterList_: arbiterList_, registry_: registry_, treasury_: treasury_,
            supplier: supplier, buyerRefund: buyerRefund,
            totalAmount: totalAmount, feeBps: feeBps,
            acceptanceDeadlineTs: acceptanceDeadlineTs,
            arbiterDeadlineHours: arbiterDeadlineHours,
            fundFirst: fundFirst, arbiterFee: arbiterFee, feePayer: feePayer
        });
        return _executeCreateDealWithPanelCore(p, arbiter, panel, milestoneInputs);
    }

    function _executeCreateDealWithPanelCore(
        _PanelParams memory p,
        address arbiter,
        address[] calldata panel,
        IWaybillEscrow.MilestoneInput[] calldata milestoneInputs
    ) private returns (uint256 dealId) {
        // ── Empty panel: legacy single-arbiter route ─────────────────────────
        if (panel.length == 0) {
            return _createDealCore(
                p.usdc_, p.maxDealAmount_, p.maxLocked_, p.arbiterList_, p.registry_, p.treasury_,
                p.supplier, p.buyerRefund, arbiter,
                p.totalAmount, p.feeBps, p.acceptanceDeadlineTs, p.arbiterDeadlineHours,
                milestoneInputs, p.fundFirst, p.arbiterFee, p.feePayer
            );
        }

        // ── Panel must be exactly 3 ──────────────────────────────────────────
        if (panel.length != 3) revert IWaybillEscrow.InvalidPanelSize();

        // ── Validate panel members ───────────────────────────────────────────
        _validatePanel(p.arbiterList_, p.supplier, panel);

        // Use panel[0] as the nominal arbiter — it is allow-listed and non-buyer/supplier.
        // _createDealCore checks panel[0] against attestors via AttestorIsArbiter.
        // panel[1] and panel[2] are validated against attestors via _validatePanelAttestors below.
        dealId = _createDealCore(
            p.usdc_, p.maxDealAmount_, p.maxLocked_, p.arbiterList_, p.registry_, p.treasury_,
            p.supplier, p.buyerRefund, panel[0],
            p.totalAmount, p.feeBps, p.acceptanceDeadlineTs, p.arbiterDeadlineHours,
            milestoneInputs, p.fundFirst, p.arbiterFee, p.feePayer
        );

        // ── Validate panel[1] and panel[2] against all stored attestors ──────
        _validatePanelAttestors(dealId, panel[1], panel[2], uint8(milestoneInputs.length));

        // ── Store panel membership ───────────────────────────────────────────
        WaybillStorage.Layout storage s = _layout();
        s.panelMembers[dealId][0] = panel[0];
        s.panelMembers[dealId][1] = panel[1];
        s.panelMembers[dealId][2] = panel[2];
        // deal.arbiterAccepted remains false until all three call acceptArbiter. Correct.
    }

    /// @dev Validate three panel members: non-zero, not buyer, not supplier, allow-listed, no dupes.
    function _validatePanel(address arbiterList_, address supplier, address[] calldata panel) private view {
        for (uint8 k = 0; k < 3; k++) {
            address m = panel[k];
            if (m == address(0))      revert IWaybillEscrow.PanelMemberZero();
            if (m == msg.sender)      revert IWaybillEscrow.PanelMemberIsBuyer();
            if (m == supplier)        revert IWaybillEscrow.PanelMemberIsSupplier();
            if (!IArbiterList(arbiterList_).isAllowed(m)) revert IWaybillEscrow.PanelMemberNotAllowed();
            for (uint8 j = 0; j < k; j++) {
                if (panel[j] == m) revert IWaybillEscrow.PanelMemberDuplicate();
            }
        }
    }

    /// @dev After _createDealCore has stored attestors, check panel[1] and panel[2] do not
    ///      appear as attestors in any milestone. panel[0] was already checked via AttestorIsArbiter.
    function _validatePanelAttestors(uint256 dealId, address p1, address p2, uint8 mc) private view {
        WaybillStorage.Layout storage s = _layout();
        for (uint8 i = 0; i < mc; i++) {
            uint8 ac = s.attestorCount[dealId][i];
            for (uint8 j = 0; j < ac; j++) {
                address att = s.attestors[dealId][i][j];
                if (att == p1 || att == p2) revert IWaybillEscrow.PanelMemberIsAttestor();
            }
        }
    }

    // -------------------------------------------------------------------------
    // cancelUnaccepted
    // -------------------------------------------------------------------------

    function executeCancelUnaccepted(address usdc_, uint256 dealId) external {
        WaybillStorage.Layout storage s = _layout();
        IWaybillEscrow.Deal storage deal = s.deals[dealId];
        if (deal.buyer == address(0)) revert IWaybillEscrow.DealMissing();

        if (deal.state == IWaybillEscrow.DealState.FUNDED) {
            if (!deal.fundFirst)                              revert IWaybillEscrow.InvalidDealState();
            if (block.timestamp <= deal.acceptanceDeadline)   revert IWaybillEscrow.AcceptanceNotExpired();
            if (deal.supplierPayout != address(0))            revert IWaybillEscrow.AlreadyAccepted();

            // C-1: revert if any milestone is currently DISPUTED
            uint8 n = deal.milestoneCount;
            for (uint8 i = 0; i < n; i++) {
                if (s.milestones[dealId][i].state == IWaybillEscrow.MilestoneState.DISPUTED)
                    revert IWaybillEscrow.Disputed();
            }

            // C-1: compute remaining = sum of (tranche + fee) for milestones not yet settled out
            uint256 remaining;
            uint256 accumulated;   // tracks principal already accounted for by bps sum
            for (uint8 i = 0; i < n; i++) {
                IWaybillEscrow.MilestoneState mstate = s.milestones[dealId][i].state;
                if (mstate == IWaybillEscrow.MilestoneState.RELEASED  ||
                    mstate == IWaybillEscrow.MilestoneState.REFUNDED  ||
                    mstate == IWaybillEscrow.MilestoneState.RESOLVED) {
                    // tranche already left the escrow — don't count it
                    if (i + 1 < n) {
                        accumulated += (deal.totalAmount * s.milestones[dealId][i].bps) / 10_000;
                    }
                    continue;
                }
                // Tranche principal: last milestone gets remainder so sum == totalAmount
                uint256 tranche;
                if (i + 1 == n) {
                    tranche = deal.totalAmount - accumulated;
                } else {
                    tranche = (deal.totalAmount * s.milestones[dealId][i].bps) / 10_000;
                    accumulated += tranche;
                }
                // (04g) Buyer only gets back what they deposited: principal + their fee portion.
                remaining += tranche + s.buyerPaidFee[dealId][i];
            }

            // (04c) add any unpaid arbiter fee to the buyer's refund
            if (deal.arbiterFee > 0 && !s.arbiterFeePaid[dealId] && !s.arbiterFeeRefunded[dealId]) {
                remaining += deal.arbiterFee;
                s.arbiterFeeRefunded[dealId] = true;
            }

            deal.state = IWaybillEscrow.DealState.CANCELLED;
            emit IWaybillEscrow.DealCancelled(dealId);

            if (remaining == 0) return;

            s.currentLocked -= remaining;
            IERC20(usdc_).safeTransfer(deal.buyerRefund, remaining);
            return;
        }

        if (deal.state != IWaybillEscrow.DealState.PROPOSED) revert IWaybillEscrow.InvalidDealState();
        if (block.timestamp <= deal.acceptanceDeadline)       revert IWaybillEscrow.AcceptanceNotExpired();
        if (_isFullyAccepted(s, dealId))                      revert IWaybillEscrow.AlreadyAccepted();
        deal.state = IWaybillEscrow.DealState.CANCELLED;
        emit IWaybillEscrow.DealCancelled(dealId);
    }

    // -------------------------------------------------------------------------
    // fund
    // -------------------------------------------------------------------------

    function executeFund(address usdc_, uint256 maxLocked_, uint256 dealId) external {
        WaybillStorage.Layout storage s = _layout();
        if (s.newDealsPaused) revert IWaybillEscrow.NewDealsPausedError();

        IWaybillEscrow.Deal storage deal = s.deals[dealId];
        if (deal.buyer == address(0)) revert IWaybillEscrow.DealMissing();
        if (deal.state != IWaybillEscrow.DealState.PROPOSED && deal.state != IWaybillEscrow.DealState.ACCEPTED)
            revert IWaybillEscrow.InvalidDealState();
        if (msg.sender != deal.buyer) revert IWaybillEscrow.NotBuyer();
        if (!deal.fundFirst && !_isFullyAccepted(s, dealId)) revert IWaybillEscrow.NotFullyAccepted();
        uint256 totalFund = deal.totalAmount + deal.prepaidFee + deal.arbiterFee;
        if (s.currentLocked + totalFund > maxLocked_)
            revert IWaybillEscrow.MaxLockedExceeded();

        deal.state = IWaybillEscrow.DealState.FUNDED;
        s.currentLocked += totalFund;

        // Atomic: transfer totalAmount + prepaidFee + arbiterFee in a single safeTransferFrom
        IERC20(usdc_).safeTransferFrom(msg.sender, address(this), totalFund);

        uint8 n = deal.milestoneCount;
        for (uint8 i = 0; i < n; i++) {
            IWaybillEscrow.Milestone storage ms = s.milestones[dealId][i];
            if (ms.condition == IWaybillEscrow.ReleaseCondition.ACCEPTANCE) {
                if (ms.reviewWindow == 0) {
                    ms.state = IWaybillEscrow.MilestoneState.CLAIMABLE;
                    emit IWaybillEscrow.MilestoneClaimable(dealId, i);
                } else {
                    ms.state = IWaybillEscrow.MilestoneState.IN_REVIEW;
                    ms.reviewWindowStart = uint64(block.timestamp);
                    emit IWaybillEscrow.ReviewWindowStarted(dealId, i, ms.reviewWindowStart, ms.reviewWindow);
                }
            }
        }

        emit IWaybillEscrow.DealFunded(dealId, deal.totalAmount, deal.prepaidFee + deal.arbiterFee);
    }

    // -------------------------------------------------------------------------
    // Storage accessor (same slot as WaybillStorage._layout())
    // -------------------------------------------------------------------------

    bytes32 private constant _LAYOUT_SLOT =
        0xb4fa23afe5bab73bfce64e08dd9c3fa4b4e0e6d3c41b48c5af5ed2ffc4d84e00;

    function _layout() private pure returns (WaybillStorage.Layout storage l) {
        bytes32 slot = _LAYOUT_SLOT;
        assembly { l.slot := slot }
    }
}
