// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IAttestorRegistry — count-only attestor reputation ledger with profile and auto-suspend.
/// @notice Records attested / upheld / slashed counts per attestor address.
///         Holds ZERO tokens. No transfer/approve surface.
interface IAttestorRegistry {
    // -------------------------------------------------------------------------
    // Enums
    // -------------------------------------------------------------------------

    enum OutcomeKind { Attested, Upheld, Slashed }
    enum Status { None, Registered, Suspended }

    // -------------------------------------------------------------------------
    // Structs
    // -------------------------------------------------------------------------

    /// @notice Self-managed attestor profile. Wallet address is implicit (msg.sender == wallet).
    struct Profile {
        string  name;      // display / business name
        string  city;      // city / region
        uint64  agentId;   // ERC-8004 agent id; 0 = unlinked
    }

    // -------------------------------------------------------------------------
    // Errors
    // -------------------------------------------------------------------------

    error NotPauser();
    error NotWriter();
    error ZeroAddress();
    error DirectParamChange();
    error NoPendingChange();
    error ChangeDelayActive();
    error AlreadyWriter();
    error NotAWriter();
    /// @notice Caller tried to overwrite another wallet's profile.
    error NotProfileOwner();
    /// @notice No auto-suspension is pending for this attestor.
    error NoAutoSuspensionPending();

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    event WriterAdded(address indexed writer);
    event WriterRemoved(address indexed writer);
    event OutcomeRecorded(
        address indexed attestor,
        OutcomeKind kind,
        uint32 attested,
        uint32 upheld,
        uint32 slashed
    );
    event StatusScheduled(address indexed attestor, Status status, uint64 eta);
    event StatusExecuted(address indexed attestor, Status status);
    /// @notice Fired when the 3rd (or Nth multiple-of-3) Upheld outcome triggers an auto-suspension.
    event AutoSuspensionScheduled(address indexed attestor, uint64 eta);
    /// @notice Fired when the pauser cancels a pending auto-suspension.
    event AutoSuspensionCancelled(address indexed attestor);
    /// @notice Fired when an attestor sets or updates their profile.
    event ProfileUpdated(address indexed attestor, string name, string city, uint64 agentId);

    // -------------------------------------------------------------------------
    // Writer management (immediate, onlyPauser)
    // -------------------------------------------------------------------------

    function addWriter(address writer) external;
    function removeWriter(address writer) external;

    // -------------------------------------------------------------------------
    // Outcome recording
    // -------------------------------------------------------------------------

    /// @notice onlyWriter. Increments the matching counter for `attestor`.
    ///         Saturates at type(uint32).max rather than overflowing.
    ///         On the 3rd (or every multiple-of-3) Upheld, automatically schedules
    ///         a 48-hour delayed Suspended status change (one-shot per crossing).
    function recordOutcome(address attestor, OutcomeKind kind) external;

    // -------------------------------------------------------------------------
    // Status management (48-hour timelock)
    // -------------------------------------------------------------------------

    /// @notice Direct status change — always reverts DirectParamChange.
    function setStatus(address attestor, Status status) external;

    /// @notice Schedule a manual status change. onlyPauser. eta = now + 48h.
    function scheduleSetStatus(address attestor, Status status) external;

    /// @notice Execute a pending status change (manual or auto) after the delay. onlyPauser.
    function executeSetStatus(address attestor) external;

    /// @notice Cancel a pending AUTO-suspension. Does not cancel manually-scheduled status changes.
    ///         onlyPauser. Allows a future Upheld multiple to trigger a fresh auto-suspend.
    function cancelAutoSuspension(address attestor) external;

    // -------------------------------------------------------------------------
    // Profile management
    // -------------------------------------------------------------------------

    /// @notice Create or update the caller's own profile. msg.sender == wallet.
    function setProfile(string calldata name, string calldata city, uint64 agentId) external;

    // -------------------------------------------------------------------------
    // Views
    // -------------------------------------------------------------------------

    function pauser() external view returns (address);
    function isWriter(address writer) external view returns (bool);
    function status(address attestor) external view returns (Status);
    function counts(address attestor) external view returns (uint32 attested, uint32 upheld, uint32 slashed);
    function getPendingStatus(address attestor) external view returns (Status pendingStatus, uint64 eta);
    function getProfile(address attestor) external view returns (string memory name, string memory city, uint64 agentId);
    /// @notice True when a pending status change was triggered automatically (not manually scheduled).
    function isAutoSuspensionPending(address attestor) external view returns (bool);
}
