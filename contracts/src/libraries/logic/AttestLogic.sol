// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ECDSA}           from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IWaybillEscrow}  from "../../interfaces/IWaybillEscrow.sol";
import {WaybillStorage}  from "../../core/WaybillStorage.sol";

interface IERC1271Attest {
    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4);
}

/// @title AttestLogic
/// @notice External library for attest() and approveMilestone().
///         Handles EIP-712 digest, ECDSA recovery, ERC-1271 fallback, and
///         threshold / review-window state transitions.
library AttestLogic {
    bytes4 private constant ERC1271_MAGIC = 0x1626ba7e;

    // -------------------------------------------------------------------------
    // attest
    // -------------------------------------------------------------------------

    function executeAttest(
        bytes32 domainSeparator,
        bytes32 attestationTypehash,
        bytes32 statementVersion,
        uint256 dealId,
        uint8   milestoneIndex,
        bytes32 evidenceHash,
        uint64  signedAt,
        uint64  expiry,
        address signer,
        bytes calldata signature
    ) external {
        WaybillStorage.Layout storage s = _layout();
        IWaybillEscrow.Deal storage deal = s.deals[dealId];
        if (deal.state != IWaybillEscrow.DealState.FUNDED)    revert IWaybillEscrow.InvalidDealState();
        if (milestoneIndex >= deal.milestoneCount)             revert IWaybillEscrow.InvalidMilestone();

        IWaybillEscrow.Milestone storage ms = s.milestones[dealId][milestoneIndex];
        _markOverdueIfNeeded(ms);

        if (ms.condition != IWaybillEscrow.ReleaseCondition.ATTESTATION) revert IWaybillEscrow.NotAttestationMilestone();
        if (ms.state != IWaybillEscrow.MilestoneState.WAITING && ms.state != IWaybillEscrow.MilestoneState.OVERDUE)
            revert IWaybillEscrow.InvalidMilestoneState();
        if (expiry <= block.timestamp)  revert IWaybillEscrow.SignatureExpired();
        if (signedAt > expiry)          revert IWaybillEscrow.InvalidSignedAt();

        // signer is now part of the digest — two attestors on the same evidence produce distinct digests
        bytes32 structHash = keccak256(abi.encode(
            attestationTypehash,
            dealId,
            milestoneIndex,
            block.chainid,
            address(this),
            signer,            // binds this digest to exactly one named signer
            statementVersion,
            evidenceHash,
            signedAt,
            expiry
        ));
        bytes32 digest = _toTypedDataHash(domainSeparator, structHash);
        if (s.usedAttestations[digest]) revert IWaybillEscrow.AttestationUsed();

        // Verify the provided signer actually produced the signature
        if (!_verifySigner(signer, digest, signature)) revert IWaybillEscrow.InvalidSigner();

        // signer must be a named attestor on this milestone
        uint8 attCount = s.attestorCount[dealId][milestoneIndex];
        bool found;
        for (uint8 j = 0; j < attCount; j++) {
            if (s.attestors[dealId][milestoneIndex][j] == signer) { found = true; break; }
        }
        if (!found) revert IWaybillEscrow.NotAttestor();

        // Named attestor must have called acceptAttestor before submitting a signature.
        if (!s.attestorAccepted[dealId][milestoneIndex][signer]) revert IWaybillEscrow.NotFullyAccepted();

        if (_hasAttested(s, dealId, milestoneIndex, signer)) revert IWaybillEscrow.AlreadyAttested();

        if (ms.state == IWaybillEscrow.MilestoneState.OVERDUE) {
            if (block.timestamp > _graceEnd(ms)) revert IWaybillEscrow.GraceExpired();
        }

        s.usedAttestations[digest] = true;
        s.hasAttested[dealId][milestoneIndex][signer] = true;
        ms.attestCount += 1;
        ms.evidenceHash = evidenceHash;

        emit IWaybillEscrow.AttestationSubmitted(dealId, milestoneIndex, signer, evidenceHash);

        if (ms.attestCount >= ms.threshold) {
            ms.attested = true;
            emit IWaybillEscrow.ThresholdMet(dealId, milestoneIndex, ms.threshold);

            if (ms.reviewWindow == 0) {
                ms.state = IWaybillEscrow.MilestoneState.CLAIMABLE;
                emit IWaybillEscrow.MilestoneClaimable(dealId, milestoneIndex);
            } else {
                ms.state = IWaybillEscrow.MilestoneState.IN_REVIEW;
                ms.reviewWindowStart = uint64(block.timestamp);
                emit IWaybillEscrow.ReviewWindowStarted(dealId, milestoneIndex, ms.reviewWindowStart, ms.reviewWindow);
            }
        }
    }

    // -------------------------------------------------------------------------
    // approveMilestone
    // -------------------------------------------------------------------------

    function executeApproveMilestone(uint256 dealId, uint8 milestoneIndex) external {
        WaybillStorage.Layout storage s = _layout();
        IWaybillEscrow.Deal storage deal = s.deals[dealId];
        if (deal.state != IWaybillEscrow.DealState.FUNDED) revert IWaybillEscrow.InvalidDealState();
        if (msg.sender != deal.buyer)                      revert IWaybillEscrow.NotBuyer();
        if (milestoneIndex >= deal.milestoneCount)         revert IWaybillEscrow.InvalidMilestone();

        IWaybillEscrow.Milestone storage ms = s.milestones[dealId][milestoneIndex];

        // (04f) Dependency gate: block approval if prerequisite is not yet RELEASED.
        {
            uint16 dep = s.milestoneDependsOn[dealId][milestoneIndex];
            if (dep != type(uint16).max) {
                if (s.milestones[dealId][dep].state != IWaybillEscrow.MilestoneState.RELEASED)
                    revert IWaybillEscrow.DependencyNotReleased();
            }
        }

        if (ms.state == IWaybillEscrow.MilestoneState.WAITING) {
            if (ms.condition != IWaybillEscrow.ReleaseCondition.BUYER_APPROVAL) revert IWaybillEscrow.NotBuyerApproval();
            if (ms.reviewWindow == 0) {
                ms.state = IWaybillEscrow.MilestoneState.CLAIMABLE;
                emit IWaybillEscrow.MilestoneClaimable(dealId, milestoneIndex);
            } else {
                ms.state = IWaybillEscrow.MilestoneState.IN_REVIEW;
                ms.reviewWindowStart = uint64(block.timestamp);
                emit IWaybillEscrow.ReviewWindowStarted(dealId, milestoneIndex, ms.reviewWindowStart, ms.reviewWindow);
            }
            return;
        }

        if (ms.state != IWaybillEscrow.MilestoneState.IN_REVIEW && ms.state != IWaybillEscrow.MilestoneState.REFUNDABLE)
            revert IWaybillEscrow.InvalidMilestoneState();

        bool approvedEarly = ms.state == IWaybillEscrow.MilestoneState.IN_REVIEW;
        ms.state = IWaybillEscrow.MilestoneState.CLAIMABLE;
        if (approvedEarly) {
            emit IWaybillEscrow.MilestoneApprovedEarly(dealId, milestoneIndex);
        }
        emit IWaybillEscrow.MilestoneClaimable(dealId, milestoneIndex);
    }

    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------

    /// @dev Verify that `signer` produced `signature` over `digest`.
    ///      EOA path: ECDSA.tryRecover must return `signer`.
    ///      Contract path: ERC-1271 isValidSignature must return MAGIC.
    function _verifySigner(
        address signer,
        bytes32 digest,
        bytes calldata signature
    ) private view returns (bool) {
        if (signer.code.length == 0) {
            // EOA — ECDSA recovery
            (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, signature);
            return err == ECDSA.RecoverError.NoError && recovered == signer;
        }
        // Contract — ERC-1271
        try IERC1271Attest(signer).isValidSignature(digest, signature) returns (bytes4 magic) {
            return magic == ERC1271_MAGIC;
        } catch {
            return false;
        }
    }

    function _hasAttested(
        WaybillStorage.Layout storage s,
        uint256 dealId,
        uint8   milestoneIndex,
        address signer
    ) private view returns (bool) {
        return s.hasAttested[dealId][milestoneIndex][signer];
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

    function _toTypedDataHash(bytes32 domainSeparator, bytes32 structHash) private pure returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
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
