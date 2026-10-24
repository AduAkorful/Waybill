// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IBondVault} from "../interfaces/IBondVault.sol";
import {IWaybillEscrow} from "../interfaces/IWaybillEscrow.sol";
import {IAttestorRegistry} from "../interfaces/IAttestorRegistry.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title BondVault — attestor USDC bond vault
/// @notice Holds USDC deposited by attestors. Arbiter can flag negligent attestors
///         for slashing after a 72-hour appeal window. Slash proceeds go to the
///         harmed party (buyerRefund or supplierPayout) named by the arbiter.
///         NEVER transfers to pauser/treasury/operator.
///         NEVER calls transferFrom on the escrow.
///         NEVER calls claim/refund/fund/createDeal on the escrow.
contract BondVault is IBondVault {
    using SafeERC20 for IERC20;

    // -------------------------------------------------------------------------
    // Constants
    // -------------------------------------------------------------------------

    uint64 public constant APPEAL = 72 hours;

    // -------------------------------------------------------------------------
    // Immutables
    // -------------------------------------------------------------------------

    IERC20               private immutable _usdc;
    address              public  immutable override pauser;
    IWaybillEscrow       private immutable _escrow;
    IAttestorRegistry    private immutable _registry;

    // -------------------------------------------------------------------------
    // State
    // -------------------------------------------------------------------------

    /// @notice Free (unlocked) bond balance per attestor.
    mapping(address => uint256) private _freeBond;

    /// @notice Pending + executed slashes.
    Slash[]  private _slashes;

    /// @notice Guard: one pending slash per (dealId, milestoneIndex, attestor).
    ///         Value is slashId + 1 (0 = none).
    mapping(uint256 => mapping(uint8 => mapping(address => uint256))) private _pendingSlashId;

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    constructor(
        address _usdcAddr,
        address _pauserAddr,
        address _escrowAddr,
        address _registryAddr
    ) {
        if (_usdcAddr     == address(0)) revert ZeroAddress();
        if (_pauserAddr   == address(0)) revert ZeroAddress();
        if (_escrowAddr   == address(0)) revert ZeroAddress();
        if (_registryAddr == address(0)) revert ZeroAddress();

        if (_usdcAddr.code.length     == 0) revert ZeroAddress();
        if (_escrowAddr.code.length   == 0) revert ZeroAddress();
        if (_registryAddr.code.length == 0) revert ZeroAddress();

        _usdc     = IERC20(_usdcAddr);
        pauser    = _pauserAddr;
        _escrow   = IWaybillEscrow(_escrowAddr);
        _registry = IAttestorRegistry(_registryAddr);
    }

    // -------------------------------------------------------------------------
    // Modifiers
    // -------------------------------------------------------------------------

    modifier onlyPauser() {
        if (msg.sender != pauser) revert NotPauser();
        _;
    }

    // -------------------------------------------------------------------------
    // Deposit / Withdraw
    // -------------------------------------------------------------------------

    /// @inheritdoc IBondVault
    function deposit(uint256 amount) external override {
        if (amount == 0) revert ZeroAmount();
        _freeBond[msg.sender] += amount;
        // SafeERC20: pull from attestor; reverts on failure
        _usdc.safeTransferFrom(msg.sender, address(this), amount);
        emit BondDeposited(msg.sender, amount);
    }

    /// @inheritdoc IBondVault
    function withdraw(uint256 amount) external override {
        if (amount == 0) revert ZeroAmount();
        if (_freeBond[msg.sender] < amount) revert InsufficientBond();
        _freeBond[msg.sender] -= amount;
        _usdc.safeTransfer(msg.sender, amount);
        emit BondWithdrawn(msg.sender, amount);
    }

    // -------------------------------------------------------------------------
    // Flag / Reverse / Execute
    // -------------------------------------------------------------------------

    /// @inheritdoc IBondVault
    function flagNegligent(
        uint256 dealId,
        uint8   milestoneIndex,
        address attestor,
        uint16  slashBps,
        address harmed
    ) external override returns (uint256 slashId) {
        if (slashBps == 0 || slashBps > 10_000) revert InvalidBps();
        if (harmed == address(0)) revert ZeroAddress();

        // Caller must be the deal's arbiter
        IWaybillEscrow.Deal memory deal = _escrow.getDeal(dealId);
        if (msg.sender != deal.arbiter) revert NotArbiter();

        // Deal must be FUNDED or SETTLED
        if (
            deal.state != IWaybillEscrow.DealState.FUNDED &&
            deal.state != IWaybillEscrow.DealState.SETTLED
        ) revert NotDisputedOrResolved();

        // Milestone must be DISPUTED or RESOLVED
        IWaybillEscrow.Milestone memory ms = _escrow.getMilestone(dealId, milestoneIndex);
        if (
            ms.state != IWaybillEscrow.MilestoneState.DISPUTED &&
            ms.state != IWaybillEscrow.MilestoneState.RESOLVED
        ) revert NotDisputedOrResolved();

        // attestor must be in the milestone's attestor list
        address[] memory attestors = _escrow.getAttestors(dealId, milestoneIndex);
        bool listed = false;
        for (uint256 i = 0; i < attestors.length; i++) {
            if (attestors[i] == attestor) { listed = true; break; }
        }
        if (!listed) revert NotListedAttestor();

        // harmed must not be forbidden
        if (
            harmed == pauser              ||
            harmed == deal.protocolTreasury ||
            harmed == attestor            ||
            harmed == address(this)
        ) revert HarmedForbidden();

        // harmed must be a deal party (buyerRefund or supplierPayout)
        if (harmed != deal.buyerRefund && harmed != deal.supplierPayout) revert HarmedNotParty();

        // One pending slash per (dealId, milestoneIndex, attestor)
        if (_pendingSlashId[dealId][milestoneIndex][attestor] != 0) revert SlashPending();

        // Compute slash amount from freeBond
        uint256 amount = _freeBond[attestor] * slashBps / 10_000;
        if (amount == 0) revert InsufficientBond();

        // Deduct freeBond (CEI)
        _freeBond[attestor] -= amount;

        // Store pending slash
        slashId = _slashes.length;
        _slashes.push(Slash({
            dealId:          dealId,
            milestoneIndex:  milestoneIndex,
            attestor:        attestor,
            harmed:          harmed,
            amount:          amount,
            eta:             uint64(block.timestamp) + APPEAL,
            reversed:        false,
            executed:        false
        }));
        _pendingSlashId[dealId][milestoneIndex][attestor] = slashId + 1;

        emit SlashFlagged(slashId, dealId, milestoneIndex, attestor, harmed, slashBps, amount, _slashes[slashId].eta);
    }

    /// @inheritdoc IBondVault
    function reverseFlag(uint256 slashId) external override {
        if (slashId >= _slashes.length) revert NoPendingSlash();
        Slash storage s = _slashes[slashId];
        if (s.reversed) revert AlreadyReversed();
        if (s.executed) revert AlreadyReversed();

        // Only the deal's arbiter may reverse
        IWaybillEscrow.Deal memory deal = _escrow.getDeal(s.dealId);
        if (msg.sender != deal.arbiter) revert NotArbiter();

        // Must be before eta
        if (block.timestamp >= s.eta) revert AppealActive();

        // Restore freeBond
        _freeBond[s.attestor] += s.amount;
        s.reversed = true;

        // Clear pending guard so a new flag can be made
        _pendingSlashId[s.dealId][s.milestoneIndex][s.attestor] = 0;

        emit SlashReversed(slashId);
    }

    /// @inheritdoc IBondVault
    function executeSlash(uint256 slashId) external override {
        if (slashId >= _slashes.length) revert NoPendingSlash();
        Slash storage s = _slashes[slashId];
        if (s.reversed) revert AlreadyReversed();
        if (s.executed) revert NoPendingSlash();

        // Appeal window must have elapsed
        if (block.timestamp < s.eta) revert AppealActive();

        // Mark executed before external calls (CEI)
        s.executed = true;
        // Clear pending guard
        _pendingSlashId[s.dealId][s.milestoneIndex][s.attestor] = 0;

        // Transfer to harmed party
        _usdc.safeTransfer(s.harmed, s.amount);

        // Record both Slashed and Upheld in registry (no try/catch — revert on failure)
        _registry.recordOutcome(s.attestor, IAttestorRegistry.OutcomeKind.Slashed);
        _registry.recordOutcome(s.attestor, IAttestorRegistry.OutcomeKind.Upheld);

        emit SlashExecuted(slashId, s.harmed, s.amount);
    }

    // -------------------------------------------------------------------------
    // Views
    // -------------------------------------------------------------------------

    function usdc()      external view override returns (address) { return address(_usdc); }
    function escrow()    external view override returns (address) { return address(_escrow); }
    function registry()  external view override returns (address) { return address(_registry); }
    function freeBond(address attestor) external view override returns (uint256) { return _freeBond[attestor]; }
    function nextSlashId() external view override returns (uint256) { return _slashes.length; }

    function getSlash(uint256 slashId) external view override returns (Slash memory) {
        if (slashId >= _slashes.length) revert NoPendingSlash();
        return _slashes[slashId];
    }
}
