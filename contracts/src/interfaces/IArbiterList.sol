// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IArbiterList — canonical ABI surface for the eligible-arbiter registry.
/// @notice Holds ZERO tokens. Escrow reads isAllowed(); all money stays in escrow.
interface IArbiterList {

    // -------------------------------------------------------------------------
    // Errors
    // -------------------------------------------------------------------------

    error NotPauser();
    error ZeroAddress();
    error DirectParamChange();   // addArbiter/removeArbiter called directly
    error NoPendingChange();
    error ChangeDelayActive();
    error AlreadyAllowed();      // scheduleAddArbiter on an already-allowed address
    error NotOnList();           // scheduleRemoveArbiter on an address not on the list

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    event ArbiterAdded(address indexed arbiter, uint256 feeUsdc);
    event ArbiterRemoved(address indexed arbiter);
    event AddArbiterScheduled(address indexed arbiter, uint256 feeUsdc, uint64 eta);
    event AddArbiterExecuted(address indexed arbiter);
    event RemoveArbiterScheduled(address indexed arbiter, uint64 eta);
    event RemoveArbiterExecuted(address indexed arbiter);

    // -------------------------------------------------------------------------
    // State-mutating — onlyPauser
    // -------------------------------------------------------------------------

    /// @notice Always reverts DirectParamChange. Use scheduleAddArbiter instead.
    function addArbiter(address arbiter) external;

    /// @notice Always reverts DirectParamChange. Use scheduleRemoveArbiter instead.
    function removeArbiter(address arbiter) external;

    function scheduleAddArbiter(address arbiter, uint256 feeUsdc) external;
    function executeAddArbiter(address arbiter) external;

    function scheduleRemoveArbiter(address arbiter) external;
    function executeRemoveArbiter(address arbiter) external;

    // -------------------------------------------------------------------------
    // Views
    // -------------------------------------------------------------------------

    function isAllowed(address arbiter) external view returns (bool);
    function feeUsdc(address arbiter) external view returns (uint256);
    function pauser() external view returns (address);

    /// @return fee   advertised feeUsdc set at schedule time
    /// @return eta   earliest timestamp execute can be called (0 = no pending)
    function getPendingAdd(address arbiter) external view returns (uint256 fee, uint64 eta);

    /// @return eta  earliest timestamp execute can be called (0 = no pending)
    function getPendingRemove(address arbiter) external view returns (uint64 eta);
}
