// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IWaybillEscrow}  from "../../interfaces/IWaybillEscrow.sol";
import {WaybillStorage}  from "../../core/WaybillStorage.sol";

/// @title ViewLogic
/// @notice External library for every IWaybillEscrow view function.
///         Functions are `external view` — Solidity uses STATICCALL so no
///         storage writes possible here.
library ViewLogic {

    function getDeal(uint256 dealId) external view returns (IWaybillEscrow.Deal memory) {
        return _layout().deals[dealId];
    }

    function getMilestone(uint256 dealId, uint8 milestoneIndex)
        external view returns (IWaybillEscrow.Milestone memory)
    {
        WaybillStorage.Layout storage s = _layout();
        if (milestoneIndex >= s.deals[dealId].milestoneCount) revert IWaybillEscrow.InvalidMilestone();
        return s.milestones[dealId][milestoneIndex];
    }

    function getAttestors(uint256 dealId, uint8 milestoneIndex)
        external view returns (address[] memory)
    {
        WaybillStorage.Layout storage s = _layout();
        uint8 count = s.attestorCount[dealId][milestoneIndex];
        address[] memory result = new address[](count);
        for (uint8 j = 0; j < count; j++) {
            result[j] = s.attestors[dealId][milestoneIndex][j];
        }
        return result;
    }

    function getThreshold(uint256 dealId, uint8 milestoneIndex) external view returns (uint8) {
        return _layout().milestones[dealId][milestoneIndex].threshold;
    }

    function getTrancheFee(uint256 dealId, uint8 milestoneIndex) external view returns (uint256) {
        WaybillStorage.Layout storage s = _layout();
        if (milestoneIndex >= s.deals[dealId].milestoneCount) revert IWaybillEscrow.InvalidMilestone();
        return s.trancheFees[dealId][milestoneIndex];
    }

    function isFullyAccepted(uint256 dealId) external view returns (bool) {
        WaybillStorage.Layout storage s = _layout();
        IWaybillEscrow.Deal storage deal = s.deals[dealId];
        if (deal.supplier == address(0) || deal.supplierPayout == address(0)) return false;
        if (!deal.arbiterAccepted) return false;
        for (uint8 i = 0; i < deal.milestoneCount; i++) {
            IWaybillEscrow.Milestone storage ms = s.milestones[dealId][i];
            if (ms.condition == IWaybillEscrow.ReleaseCondition.ATTESTATION && !ms.attestorAccepted)
                return false;
        }
        return true;
    }

    function feeBalance(address account) external view returns (uint256) {
        return _layout().feeBalances[account];
    }

    function getDisputeResponse(uint256 dealId, uint8 milestoneIndex) external view returns (bytes32) {
        return _layout().milestones[dealId][milestoneIndex].responseHash;
    }

    function getPendingPayoutChange(uint256 dealId)
        external view returns (IWaybillEscrow.PendingAddressChange memory)
    {
        return _layout().pendingPayout[dealId];
    }

    function getPendingRefundChange(uint256 dealId)
        external view returns (IWaybillEscrow.PendingAddressChange memory)
    {
        return _layout().pendingRefund[dealId];
    }

    function getPendingTreasury() external view returns (address proposed, uint64 eta) {
        WaybillStorage.PendingTreasury memory p = _layout().pendingTreasury;
        return (p.proposed, p.eta);
    }

    function getPendingFeeBpsRange() external view returns (uint16 minBps, uint16 maxBps, uint64 eta) {
        WaybillStorage.PendingFeeBpsRange memory p = _layout().pendingFeeBpsRange;
        return (p.minBps, p.maxBps, p.eta);
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
