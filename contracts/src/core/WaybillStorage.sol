// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IWaybillEscrow}    from "../interfaces/IWaybillEscrow.sol";
import {IArbiterList}      from "../interfaces/IArbiterList.sol";
import {IAttestorRegistry} from "../interfaces/IAttestorRegistry.sol";
import {IERC20}            from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title WaybillStorage
/// @notice Abstract base that holds ALL escrow state and immutables.
///         Inherited by WaybillEscrow and accessed by logic libraries via
///         a namespaced ERC-7201 storage slot so external library functions
///         can read/write escrow state through DELEGATECALL.
///
///         No external functions are declared here.
abstract contract WaybillStorage {
    // -------------------------------------------------------------------------
    // Namespaced storage struct  (ERC-7201 / Aave-style)
    // -------------------------------------------------------------------------

    /// @dev keccak256("waybill.escrow.storage") - 1  → stable across upgrades
    bytes32 private constant _LAYOUT_SLOT =
        0xb4fa23afe5bab73bfce64e08dd9c3fa4b4e0e6d3c41b48c5af5ed2ffc4d84e00;

    struct Layout {
        // ── mutable scalars ──────────────────────────────────────────────────
        uint256  currentLocked;
        bool     newDealsPaused;
        uint256  nextDealId;
        address  treasury;
        uint16   minFeeBps;
        uint16   maxFeeBps;

        // ── parameter timelocks (03e) ─────────────────────────────────────────
        PendingTreasury    pendingTreasury;
        PendingFeeBpsRange pendingFeeBpsRange;

        // ── deal + milestone maps ──────────────────────────────────────────────
        mapping(uint256 => IWaybillEscrow.Deal)           deals;
        mapping(uint256 => IWaybillEscrow.Milestone[8])   milestones;
        mapping(uint256 => uint256[8])                    trancheFees;

        // ── n-of-m attestor storage ────────────────────────────────────────────
        mapping(uint256 => mapping(uint8 => address[5]))                       attestors;
        mapping(uint256 => mapping(uint8 => uint8))                            attestorCount;
        mapping(uint256 => mapping(uint8 => mapping(address => bool)))         attestorAccepted;
        mapping(uint256 => mapping(uint8 => uint8))                            acceptedCount;
        mapping(uint256 => mapping(uint8 => mapping(address => bool)))         hasAttested;

        // ── address-change proposals (03d) ────────────────────────────────────
        mapping(uint256 => IWaybillEscrow.PendingAddressChange) pendingPayout;
        mapping(uint256 => IWaybillEscrow.PendingAddressChange) pendingRefund;

        // ── attestation replay guard ───────────────────────────────────────────
        mapping(bytes32 => bool)  usedAttestations;

        // ── fee ledger ──────────────────────────────────────────────────────────
        mapping(address => uint256) feeBalances;

        // ── dispute evidence (04d) ────────────────────────────────────────────────
        // append-only per-deal/milestone; indexed 0..n-1 in submission order
        mapping(uint256 => mapping(uint8 => bytes32[])) disputeEvidence;

        // ── arbiter fee accounting (04c) ────────────────────────────────────────
        // arbiterFeePaid[dealId]          — true after first timely resolve credits the arbiter
        // arbiterFeeRefunded[dealId]      — true after no-dispute settle OR default refund succeeds
        // arbiterFeeClaimable[dealId]     — (H-04c-1) per-deal claimable amount for the named arbiter
        // arbiterFeeBalances[arbiter]     — (H-04c-3) SEPARATE aggregate arbiter-fee ledger;
        //                                   never mixed into feeBalances so withdrawFees() cannot touch it
        // arbiterFeeRefundPending[dealId] — (H-04c-2) non-zero when buyer refund transfer failed;
        //                                   currentLocked is NOT decremented until delivery
        mapping(uint256 => bool)    arbiterFeePaid;
        mapping(uint256 => bool)    arbiterFeeRefunded;
        mapping(uint256 => uint256) arbiterFeeClaimable;
        mapping(address => uint256) arbiterFeeBalances;
        mapping(uint256 => uint256) arbiterFeeRefundPending;

        // ── 04e cascade refund pending (blocked buyer transfer on cascade) ──────
        // cascadeRefundPending[dealId][milestoneIndex] = amount still owed
        // currentLocked is NOT decremented until delivery succeeds
        mapping(uint256 => mapping(uint8 => uint256)) cascadeRefundPending;

        // ── 04f dependent milestones ────────────────────────────────────────────
        // dependsOn[dealId][milestoneIndex] = prerequisite index, or type(uint16).max if independent
        mapping(uint256 => uint16[8]) milestoneDependsOn;

        // ── 04g fee-payer mode ───────────────────────────────────────────────────
        // buyerPaidFee[dealId][milestoneIndex] = the portion of the protocol fee the buyer deposited
        //   BuyerPrepaid    -> full trancheFee
        //   SupplierDeducted-> 0
        //   Split           -> ceil(trancheFee/2) for non-final tranches; remainder for final
        // Used in _refundBuyer and _cascadeRefundBuyer to return exactly what the buyer deposited.
        mapping(uint256 => uint256[8]) buyerPaidFee;

        // ── 04h panel arbitration ────────────────────────────────────────────────
        // panelMembers[dealId][0..2]  — addresses of the 3 panel arbiters (all zero for single-arbiter deals)
        // panelMemberAccepted[dealId][member] — true once a panel member has called acceptArbiter
        // panelAcceptCount[dealId]    — number of panel members who have accepted (0..3)
        // panelVotes[dealId][milestoneIndex][member] — encoded vote (0=unvoted, 1=buyer, 2=supplier, 4..10002=split)
        mapping(uint256 => address[3])                                    panelMembers;
        mapping(uint256 => mapping(address => bool))                      panelMemberAccepted;
        mapping(uint256 => uint8)                                         panelAcceptCount;
        mapping(uint256 => mapping(uint8 => mapping(address => uint32))) panelVotes;

        // ── (33) Rebuttal window ──────────────────────────────────────────────
        // decisionOpensAt[dealId][milestoneIndex] — once the other side responds, the earliest time the arbiter or
        // panel may decide (response + REBUTTAL_PERIOD, or earlier if the raiser waives). 0 while no response.
        mapping(uint256 => mapping(uint8 => uint64))                      decisionOpensAt;

        // ── (51) Early-access caps, adjustable by the pauser ─────────────────
        // Lowering applies at once; raising waits CAP_RAISE_DELAY so it is public before it applies.
        // Caps are checked only when a deal is created or funded; funded deals are never affected.
        uint256      maxDealAmount;
        uint256      maxLocked;
        PendingCaps  pendingCaps;
    }

    // ── timelock structs (kept here so Layout compiles) ──────────────────────
    struct PendingTreasury    { address proposed; uint64 eta; }
    struct PendingFeeBpsRange { uint16 minBps; uint16 maxBps; uint64 eta; bool pending; }
    struct PendingCaps        { uint256 maxDealAmount; uint256 maxLocked; uint64 eta; bool pending; }

    /// @dev Returns the singleton Layout pointer at the fixed slot.
    ///      Works in WaybillEscrow AND in any library called via DELEGATECALL.
    function _layout() internal pure returns (Layout storage l) {
        bytes32 slot = _LAYOUT_SLOT;
        assembly { l.slot := slot }
    }

    // -------------------------------------------------------------------------
    // Immutables  (set by WaybillEscrow constructor, readable everywhere)
    // -------------------------------------------------------------------------

    IERC20            public immutable usdc;
    address           public immutable pauser;
    IArbiterList      internal immutable _arbiterListContract;
    IAttestorRegistry internal immutable _registryContract;

    // -------------------------------------------------------------------------
    // Constants accessible to libraries via the escrow's DELEGATECALL context
    // -------------------------------------------------------------------------

    bytes32 public constant STATEMENT_VERSION  = keccak256("waybill.v1");
    bytes32 public constant ATTESTATION_TYPEHASH = keccak256(
        "Attestation(uint256 dealId,uint8 milestoneIndex,uint256 chainId,address verifyingContract,address signer,bytes32 statementVersion,bytes32 evidenceHash,uint64 signedAt,uint64 expiry)"
    );
    uint8 public constant MAX_ATTESTORS = 5;

    uint64 internal constant ADDRESS_CHANGE_DELAY = 48 hours;
    uint64 internal constant PARAM_CHANGE_DELAY   = 48 hours;
}
