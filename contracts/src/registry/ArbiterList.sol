// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IArbiterList} from "../interfaces/IArbiterList.sol";

/// @title ArbiterList — timelocked registry of eligible arbiters.
/// @notice Holds ZERO tokens. No receive/fallback. No Ownable. No proxy.
///         Escrow reads isAllowed(). feeUsdc is advertised terms only; no money moves here.
contract ArbiterList is IArbiterList {

    // -------------------------------------------------------------------------
    // Constants
    // -------------------------------------------------------------------------

    uint64 public constant DELAY = 48 hours;

    // -------------------------------------------------------------------------
    // Immutables
    // -------------------------------------------------------------------------

    address public immutable pauser;

    // -------------------------------------------------------------------------
    // State
    // -------------------------------------------------------------------------

    mapping(address => bool)    private _allowed;
    mapping(address => uint256) private _feeUsdc;

    struct PendingAdd {
        uint256 feeUsdc;
        uint64  eta;
    }

    mapping(address => PendingAdd) private _pendingAdd;
    mapping(address => uint64)     private _pendingRemove;

    // -------------------------------------------------------------------------
    // Modifiers
    // -------------------------------------------------------------------------

    modifier onlyPauser() {
        if (msg.sender != pauser) revert NotPauser();
        _;
    }

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    /// @param _pauser          Address that may schedule/execute changes.
    /// @param initialArbiters  Seeded as allowed with feeUsdc=0. Must be non-zero.
    ///                         msg.sender is NOT added.
    constructor(address _pauser, address[] memory initialArbiters) {
        if (_pauser == address(0)) revert ZeroAddress();
        pauser = _pauser;

        for (uint256 i = 0; i < initialArbiters.length; i++) {
            address arb = initialArbiters[i];
            if (arb == address(0)) revert ZeroAddress();
            _allowed[arb] = true;
            _feeUsdc[arb]  = 0;
            emit ArbiterAdded(arb, 0);
        }
    }

    // -------------------------------------------------------------------------
    // Disabled direct add/remove
    // -------------------------------------------------------------------------

    function addArbiter(address) external pure override {
        revert DirectParamChange();
    }

    function removeArbiter(address) external pure override {
        revert DirectParamChange();
    }

    // -------------------------------------------------------------------------
    // Schedule / execute — add
    // -------------------------------------------------------------------------

    function scheduleAddArbiter(address arbiter, uint256 fee) external override onlyPauser {
        if (arbiter == address(0)) revert ZeroAddress();
        if (_allowed[arbiter]) revert AlreadyAllowed();
        uint64 eta = uint64(block.timestamp) + DELAY;
        _pendingAdd[arbiter] = PendingAdd({ feeUsdc: fee, eta: eta });
        emit AddArbiterScheduled(arbiter, fee, eta);
    }

    function executeAddArbiter(address arbiter) external override onlyPauser {
        PendingAdd memory p = _pendingAdd[arbiter];
        if (p.eta == 0) revert NoPendingChange();
        if (block.timestamp < p.eta) revert ChangeDelayActive();
        delete _pendingAdd[arbiter];
        _allowed[arbiter] = true;
        _feeUsdc[arbiter]  = p.feeUsdc;
        emit ArbiterAdded(arbiter, p.feeUsdc);
        emit AddArbiterExecuted(arbiter);
    }

    // -------------------------------------------------------------------------
    // Schedule / execute — remove
    // -------------------------------------------------------------------------

    function scheduleRemoveArbiter(address arbiter) external override onlyPauser {
        if (!_allowed[arbiter]) revert NotOnList();
        uint64 eta = uint64(block.timestamp) + DELAY;
        _pendingRemove[arbiter] = eta;
        emit RemoveArbiterScheduled(arbiter, eta);
    }

    function executeRemoveArbiter(address arbiter) external override onlyPauser {
        uint64 eta = _pendingRemove[arbiter];
        if (eta == 0) revert NoPendingChange();
        if (block.timestamp < eta) revert ChangeDelayActive();
        delete _pendingRemove[arbiter];
        _allowed[arbiter] = false;
        _feeUsdc[arbiter]  = 0;
        emit ArbiterRemoved(arbiter);
        emit RemoveArbiterExecuted(arbiter);
    }

    // -------------------------------------------------------------------------
    // Views
    // -------------------------------------------------------------------------

    function isAllowed(address arbiter) external view override returns (bool) {
        return _allowed[arbiter];
    }

    function feeUsdc(address arbiter) external view override returns (uint256) {
        return _feeUsdc[arbiter];
    }

    function getPendingAdd(address arbiter) external view override returns (uint256 fee, uint64 eta) {
        PendingAdd memory p = _pendingAdd[arbiter];
        return (p.feeUsdc, p.eta);
    }

    function getPendingRemove(address arbiter) external view override returns (uint64 eta) {
        return _pendingRemove[arbiter];
    }
}
