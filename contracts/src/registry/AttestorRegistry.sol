// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IAttestorRegistry} from "../interfaces/IAttestorRegistry.sol";

/// @title AttestorRegistry — count-only reputation ledger for attestors, with self-managed profiles
///                           and automatic 3-upheld suspension scheduling.
/// @notice Records attested/upheld/slashed counts pushed by authorized writers
///         (e.g. WaybillEscrow instances). Holds ZERO tokens. No ERC-20 surface.
contract AttestorRegistry is IAttestorRegistry {

    // -------------------------------------------------------------------------
    // Constants
    // -------------------------------------------------------------------------

    uint64  private constant STATUS_DELAY       = 48 hours;
    uint32  private constant UPHELD_THRESHOLD   = 3;   // auto-suspend trigger multiple

    // -------------------------------------------------------------------------
    // Immutables
    // -------------------------------------------------------------------------

    address public immutable override pauser;

    // -------------------------------------------------------------------------
    // Storage
    // -------------------------------------------------------------------------

    mapping(address => bool) private _isWriter;

    struct Counts {
        uint32 attested;
        uint32 upheld;
        uint32 slashed;
    }
    mapping(address => Counts)   private _counts;
    mapping(address => Status)   private _status;

    struct PendingStatusChange {
        Status newStatus;
        uint64 eta;
        bool   pending;
        bool   isAuto;    // true = triggered by upheld threshold; false = manual pauser schedule
    }
    mapping(address => PendingStatusChange) private _pendingStatus;

    // (04i) Per-wallet profile
    struct _ProfileStore {
        string name;
        string city;
        uint64 agentId;
    }
    mapping(address => _ProfileStore) private _profiles;

    // -------------------------------------------------------------------------
    // Modifiers
    // -------------------------------------------------------------------------

    modifier onlyPauser() {
        if (msg.sender != pauser) revert NotPauser();
        _;
    }

    modifier onlyWriter() {
        if (!_isWriter[msg.sender]) revert NotWriter();
        _;
    }

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    /// @param _pauser  Address that controls writer management and status timelocks.
    constructor(address _pauser) {
        if (_pauser == address(0)) revert ZeroAddress();
        pauser = _pauser;
    }

    // -------------------------------------------------------------------------
    // Writer management (immediate, onlyPauser)
    // -------------------------------------------------------------------------

    function addWriter(address writer) external override onlyPauser {
        if (writer == address(0)) revert ZeroAddress();
        if (_isWriter[writer]) revert AlreadyWriter();
        _isWriter[writer] = true;
        emit WriterAdded(writer);
    }

    function removeWriter(address writer) external override onlyPauser {
        if (!_isWriter[writer]) revert NotAWriter();
        _isWriter[writer] = false;
        emit WriterRemoved(writer);
    }

    // -------------------------------------------------------------------------
    // Outcome recording
    // -------------------------------------------------------------------------

    function recordOutcome(address attestor, OutcomeKind kind) external override onlyWriter {
        if (attestor == address(0)) revert ZeroAddress();
        Counts storage c = _counts[attestor];
        if (kind == OutcomeKind.Attested) {
            if (c.attested < type(uint32).max) c.attested += 1;
        } else if (kind == OutcomeKind.Upheld) {
            if (c.upheld < type(uint32).max) {
                c.upheld += 1;
                // (04i) Auto-suspend trigger: fires on every multiple of UPHELD_THRESHOLD,
                //        but only when no auto-suspension is already pending.
                if (c.upheld % UPHELD_THRESHOLD == 0 && !_pendingStatus[attestor].isAuto) {
                    uint64 eta = uint64(block.timestamp) + STATUS_DELAY;
                    _pendingStatus[attestor] = PendingStatusChange({
                        newStatus: Status.Suspended,
                        eta:       eta,
                        pending:   true,
                        isAuto:    true
                    });
                    emit AutoSuspensionScheduled(attestor, eta);
                }
            }
        } else {
            // Slashed
            if (c.slashed < type(uint32).max) c.slashed += 1;
        }
        emit OutcomeRecorded(attestor, kind, c.attested, c.upheld, c.slashed);
    }

    // -------------------------------------------------------------------------
    // Status management (48-hour timelock)
    // -------------------------------------------------------------------------

    function setStatus(address, Status) external pure override {
        revert DirectParamChange();
    }

    function scheduleSetStatus(address attestor, Status newStatus) external override onlyPauser {
        if (attestor == address(0)) revert ZeroAddress();
        uint64 eta = uint64(block.timestamp) + STATUS_DELAY;
        _pendingStatus[attestor] = PendingStatusChange({
            newStatus: newStatus,
            eta:       eta,
            pending:   true,
            isAuto:    false   // manually scheduled
        });
        emit StatusScheduled(attestor, newStatus, eta);
    }

    function executeSetStatus(address attestor) external override onlyPauser {
        PendingStatusChange storage p = _pendingStatus[attestor];
        if (!p.pending) revert NoPendingChange();
        if (block.timestamp < p.eta) revert ChangeDelayActive();
        Status newStatus = p.newStatus;
        _status[attestor] = newStatus;
        delete _pendingStatus[attestor];
        emit StatusExecuted(attestor, newStatus);
    }

    /// @notice Cancel a pending AUTO-suspension only. Reverts if no auto-suspension is pending.
    ///         Does NOT cancel manually-scheduled status changes.
    function cancelAutoSuspension(address attestor) external override onlyPauser {
        PendingStatusChange storage p = _pendingStatus[attestor];
        if (!p.pending || !p.isAuto) revert NoAutoSuspensionPending();
        delete _pendingStatus[attestor];
        emit AutoSuspensionCancelled(attestor);
    }

    // -------------------------------------------------------------------------
    // Profile management (self-only)
    // -------------------------------------------------------------------------

    function setProfile(
        string calldata name,
        string calldata city,
        uint64 agentId
    ) external override {
        _ProfileStore storage prof = _profiles[msg.sender];
        prof.name    = name;
        prof.city    = city;
        prof.agentId = agentId;
        emit ProfileUpdated(msg.sender, name, city, agentId);
    }

    // -------------------------------------------------------------------------
    // Views
    // -------------------------------------------------------------------------

    function isWriter(address writer) external view override returns (bool) {
        return _isWriter[writer];
    }

    function status(address attestor) external view override returns (Status) {
        return _status[attestor];
    }

    function counts(address attestor) external view override returns (uint32 attested, uint32 upheld, uint32 slashed) {
        Counts storage c = _counts[attestor];
        return (c.attested, c.upheld, c.slashed);
    }

    function getPendingStatus(address attestor) external view override returns (Status pendingStatus, uint64 eta) {
        PendingStatusChange storage p = _pendingStatus[attestor];
        return (p.newStatus, p.eta);
    }

    function getProfile(address attestor) external view override
        returns (string memory name, string memory city, uint64 agentId)
    {
        _ProfileStore storage prof = _profiles[attestor];
        return (prof.name, prof.city, prof.agentId);
    }

    function isAutoSuspensionPending(address attestor) external view override returns (bool) {
        PendingStatusChange storage p = _pendingStatus[attestor];
        return p.pending && p.isAuto;
    }
}
