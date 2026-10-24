// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IWaybillEscrow}  from "../../interfaces/IWaybillEscrow.sol";
import {WaybillStorage}  from "../../core/WaybillStorage.sol";

/// @title AdminLogic
/// @notice External library for pauser-gated admin functions:
///         pauseNewDeals, unpauseNewDeals, scheduleSetTreasury,
///         executeSetTreasury, scheduleSetFeeBpsRange, executeSetFeeBpsRange.
library AdminLogic {

    function executePauseNewDeals(address pauser_) external {
        if (msg.sender != pauser_) revert IWaybillEscrow.NotPauser();
        _layout().newDealsPaused = true;
        emit IWaybillEscrow.NewDealsPaused();
    }

    function executeUnpauseNewDeals(address pauser_) external {
        if (msg.sender != pauser_) revert IWaybillEscrow.NotPauser();
        _layout().newDealsPaused = false;
        emit IWaybillEscrow.NewDealsUnpaused();
    }

    function executeScheduleSetTreasury(address pauser_, address newTreasury) external {
        if (msg.sender != pauser_)          revert IWaybillEscrow.NotPauser();
        if (newTreasury == address(0))      revert IWaybillEscrow.TreasuryZeroAddress();
        uint64 eta = uint64(block.timestamp) + 48 hours;
        _layout().pendingTreasury = WaybillStorage.PendingTreasury({proposed: newTreasury, eta: eta});
        emit IWaybillEscrow.SetTreasuryScheduled(newTreasury, eta);
    }

    function executeSetTreasury(address pauser_) external {
        if (msg.sender != pauser_)          revert IWaybillEscrow.NotPauser();
        WaybillStorage.Layout storage s = _layout();
        WaybillStorage.PendingTreasury memory p = s.pendingTreasury;
        if (p.proposed == address(0))       revert IWaybillEscrow.NoPendingChange();
        if (block.timestamp < p.eta)        revert IWaybillEscrow.ChangeDelayActive();
        address old = s.treasury;
        s.treasury = p.proposed;
        delete s.pendingTreasury;
        emit IWaybillEscrow.SetTreasuryExecuted(old, p.proposed);
    }

    function executeScheduleSetFeeBpsRange(address pauser_, uint16 minBps, uint16 maxBps) external {
        if (msg.sender != pauser_)          revert IWaybillEscrow.NotPauser();
        if (minBps == 0 || maxBps > 10_000 || minBps > maxBps) revert IWaybillEscrow.InvalidFeeBpsRange();
        uint64 eta = uint64(block.timestamp) + 48 hours;
        _layout().pendingFeeBpsRange = WaybillStorage.PendingFeeBpsRange({
            minBps: minBps, maxBps: maxBps, eta: eta, pending: true
        });
        emit IWaybillEscrow.SetFeeBpsRangeScheduled(minBps, maxBps, eta);
    }

    function executeSetFeeBpsRange(address pauser_) external {
        if (msg.sender != pauser_)          revert IWaybillEscrow.NotPauser();
        WaybillStorage.Layout storage s = _layout();
        WaybillStorage.PendingFeeBpsRange memory p = s.pendingFeeBpsRange;
        if (!p.pending)                     revert IWaybillEscrow.NoPendingChange();
        if (block.timestamp < p.eta)        revert IWaybillEscrow.ChangeDelayActive();
        s.minFeeBps = p.minBps;
        s.maxFeeBps = p.maxBps;
        delete s.pendingFeeBpsRange;
        emit IWaybillEscrow.SetFeeBpsRangeExecuted(p.minBps, p.maxBps);
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
