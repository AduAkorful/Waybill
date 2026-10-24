// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712}          from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {IERC20}          from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IWaybillEscrow}  from "../interfaces/IWaybillEscrow.sol";
import {IArbiterList}    from "../interfaces/IArbiterList.sol";
import {IAttestorRegistry} from "../interfaces/IAttestorRegistry.sol";
import {WaybillStorage}  from "./WaybillStorage.sol";
import {DealLogic}       from "../libraries/logic/DealLogic.sol";
import {AttestLogic}     from "../libraries/logic/AttestLogic.sol";
import {ClaimLogic}      from "../libraries/logic/ClaimLogic.sol";
import {DisputeLogic}    from "../libraries/logic/DisputeLogic.sol";
import {AdminLogic}      from "../libraries/logic/AdminLogic.sol";
import {ViewLogic}       from "../libraries/logic/ViewLogic.sol";

/// @title WaybillEscrow
/// @notice Thin entry-point contract. All logic lives in external linked libraries
///         (DealLogic, AttestLogic, ClaimLogic, DisputeLogic, AdminLogic, ViewLogic)
///         called via DELEGATECALL so they run in this contract's storage context.
///         Storage layout is defined in WaybillStorage and accessed via ERC-7201 slot.
///         This contract holds all deal USDC. No proxy, no upgrades.
contract WaybillEscrow is IWaybillEscrow, WaybillStorage, EIP712, ReentrancyGuard {

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    constructor(
        address _usdc,
        address _treasury,
        address _pauser,
        uint256 _maxDealAmount,
        uint256 _maxLocked,
        address _arbiterList,
        address _registry
    ) EIP712("WaybillEscrow", "1") {
        if (_usdc == address(0))       revert UsdcZeroAddress();
        if (_usdc.code.length == 0)    revert UsdcNotContract();
        if (_treasury == address(0))   revert TreasuryZeroAddress();
        if (_pauser == address(0))     revert PauserZeroAddress();
        if (_maxDealAmount == 0)       revert ZeroMaxDealAmount();
        if (_maxLocked == 0)           revert ZeroMaxLocked();
        if (_arbiterList == address(0))revert ArbiterZeroAddress();
        if (_arbiterList.code.length == 0) revert UsdcNotContract();
        if (_registry == address(0))   revert RegistryZeroAddress();
        if (_registry.code.length == 0)revert RegistryNotContract();

        // Immutables — assigned once
        usdc                 = IERC20(_usdc);
        pauser               = _pauser;
        _arbiterListContract = IArbiterList(_arbiterList);
        _registryContract    = IAttestorRegistry(_registry);

        // Mutable initial values stored in the Layout struct
        WaybillStorage.Layout storage s = _layout();
        s.treasury      = _treasury;
        s.maxDealAmount = _maxDealAmount;
        s.maxLocked     = _maxLocked;
        s.minFeeBps  = 50;
        s.maxFeeBps  = 100;
    }

    // -------------------------------------------------------------------------
    // Public state accessors (read Layout fields as if they were public vars)
    // -------------------------------------------------------------------------

    function currentLocked()  external view returns (uint256) { return _layout().currentLocked; }
    function newDealsPaused() external view returns (bool)    { return _layout().newDealsPaused; }
    function nextDealId()     external view returns (uint256) { return _layout().nextDealId; }
    function treasury()       external view override returns (address) { return _layout().treasury; }
    function minFeeBps()      external view override returns (uint16)  { return _layout().minFeeBps; }
    function maxFeeBps()      external view override returns (uint16)  { return _layout().maxFeeBps; }
    function maxDealAmount()  external view override returns (uint256) { return _layout().maxDealAmount; }
    function maxLocked()      external view override returns (uint256) { return _layout().maxLocked; }

    // Public mapping accessors needed by tests / external callers
    function deals(uint256 dealId) external view returns (Deal memory) {
        return _layout().deals[dealId];
    }
    function feeBalances(address account) external view returns (uint256) {
        return _layout().feeBalances[account];
    }
    function usedAttestations(bytes32 digest) external view returns (bool) {
        return _layout().usedAttestations[digest];
    }

    // -------------------------------------------------------------------------
    // Test helper
    // -------------------------------------------------------------------------

    function hashTypedDataV4(bytes32 structHash) external view returns (bytes32) {
        return _hashTypedDataV4(structHash);
    }

    // -------------------------------------------------------------------------
    // Deal lifecycle — thin wrappers delegating to external libraries
    // -------------------------------------------------------------------------

    function createDeal(
        address supplier, address buyerRefund, address arbiter,
        uint256 totalAmount, uint16 feeBps, uint64 acceptanceDeadlineTs,
        uint32 arbiterDeadlineHours, MilestoneInput[] calldata milestoneInputs
    ) external override returns (uint256 dealId) {
        return DealLogic.executeCreateDeal(
            address(usdc), pauser, _layout().maxDealAmount, _layout().maxLocked,
            address(_arbiterListContract), address(_registryContract), _layout().treasury,
            supplier, buyerRefund, arbiter, totalAmount, feeBps,
            acceptanceDeadlineTs, arbiterDeadlineHours, milestoneInputs, false, 0,
            FeePayer.BuyerPrepaid
        );
    }

    function createDeal(
        address supplier, address buyerRefund, address arbiter,
        uint256 totalAmount, uint16 feeBps, uint64 acceptanceDeadlineTs,
        uint32 arbiterDeadlineHours, MilestoneInput[] calldata milestoneInputs,
        bool fundFirst
    ) external override returns (uint256 dealId) {
        return DealLogic.executeCreateDeal(
            address(usdc), pauser, _layout().maxDealAmount, _layout().maxLocked,
            address(_arbiterListContract), address(_registryContract), _layout().treasury,
            supplier, buyerRefund, arbiter, totalAmount, feeBps,
            acceptanceDeadlineTs, arbiterDeadlineHours, milestoneInputs, fundFirst, 0,
            FeePayer.BuyerPrepaid
        );
    }

    /// @notice (04c) createDeal with fixed arbiterFee in USDC token units.
    function createDeal(
        address supplier, address buyerRefund, address arbiter,
        uint256 totalAmount, uint16 feeBps, uint64 acceptanceDeadlineTs,
        uint32 arbiterDeadlineHours, MilestoneInput[] calldata milestoneInputs,
        bool fundFirst, uint256 arbiterFee
    ) external override returns (uint256 dealId) {
        return DealLogic.executeCreateDeal(
            address(usdc), pauser, _layout().maxDealAmount, _layout().maxLocked,
            address(_arbiterListContract), address(_registryContract), _layout().treasury,
            supplier, buyerRefund, arbiter, totalAmount, feeBps,
            acceptanceDeadlineTs, arbiterDeadlineHours, milestoneInputs, fundFirst, arbiterFee,
            FeePayer.BuyerPrepaid
        );
    }

    /// @notice (04g) createDeal with an explicit fee-payer mode.
    function createDeal(
        address supplier, address buyerRefund, address arbiter,
        uint256 totalAmount, uint16 feeBps, uint64 acceptanceDeadlineTs,
        uint32 arbiterDeadlineHours, MilestoneInput[] calldata milestoneInputs,
        bool fundFirst, uint256 arbiterFee, FeePayer feePayer
    ) external override returns (uint256 dealId) {
        return DealLogic.executeCreateDeal(
            address(usdc), pauser, _layout().maxDealAmount, _layout().maxLocked,
            address(_arbiterListContract), address(_registryContract), _layout().treasury,
            supplier, buyerRefund, arbiter, totalAmount, feeBps,
            acceptanceDeadlineTs, arbiterDeadlineHours, milestoneInputs, fundFirst, arbiterFee,
            feePayer
        );
    }

    /// @notice (04h) Create a deal with an optional 3-member arbitration panel.
    ///         panel == empty: legacy single-arbiter path using `arbiter`.
    ///         panel == 3 members: panel deal; `arbiter` is ignored.
    function createDealWithPanel(
        address supplier, address buyerRefund, address arbiter, address[] calldata panel,
        uint256 totalAmount, uint16 feeBps, uint64 acceptanceDeadlineTs,
        uint32 arbiterDeadlineHours, MilestoneInput[] calldata milestoneInputs,
        bool fundFirst, uint256 arbiterFee, FeePayer feePayer
    ) external override returns (uint256 dealId) {
        return DealLogic.executeCreateDealWithPanel(
            address(usdc), pauser, _layout().maxDealAmount, _layout().maxLocked,
            address(_arbiterListContract), address(_registryContract), _layout().treasury,
            supplier, buyerRefund, arbiter, panel, totalAmount, feeBps,
            acceptanceDeadlineTs, arbiterDeadlineHours, milestoneInputs, fundFirst, arbiterFee,
            feePayer
        );
    }

    function acceptSupplier(uint256 dealId, address payoutAddress) external override {
        DealLogic.executeAcceptSupplier(dealId, payoutAddress);
    }

    function acceptAttestor(uint256 dealId, uint8 milestoneIndex) external override {
        DealLogic.executeAcceptAttestor(dealId, milestoneIndex);
    }

    function acceptArbiter(uint256 dealId) external override {
        DealLogic.executeAcceptArbiter(dealId);
    }

    function cancelUnaccepted(uint256 dealId) external override nonReentrant {
        DealLogic.executeCancelUnaccepted(address(usdc), dealId);
    }

    function fund(uint256 dealId) external override nonReentrant {
        DealLogic.executeFund(address(usdc), _layout().maxLocked, dealId);
    }

    // -------------------------------------------------------------------------
    // Attest + milestone approval
    // -------------------------------------------------------------------------

    function attest(
        uint256 dealId, uint8 milestoneIndex, bytes32 evidenceHash,
        uint64 signedAt, uint64 expiry, address signer, bytes calldata signature
    ) external override {
        AttestLogic.executeAttest(
            _domainSeparatorV4(), ATTESTATION_TYPEHASH, STATEMENT_VERSION,
            dealId, milestoneIndex, evidenceHash, signedAt, expiry, signer, signature
        );
    }

    function approveMilestone(uint256 dealId, uint8 milestoneIndex) external override {
        AttestLogic.executeApproveMilestone(dealId, milestoneIndex);
    }

    // -------------------------------------------------------------------------
    // Claim + refund + fee withdrawal
    // -------------------------------------------------------------------------

    function claim(uint256 dealId, uint8 milestoneIndex) external override nonReentrant {
        ClaimLogic.executeClaim(address(usdc), address(_registryContract), dealId, milestoneIndex);
    }

    function refund(uint256 dealId, uint8 milestoneIndex) external override nonReentrant {
        ClaimLogic.executeRefund(address(usdc), address(_registryContract), dealId, milestoneIndex);
    }

    function withdrawFees() external override nonReentrant {
        ClaimLogic.executeWithdrawFees(address(usdc));
    }

    function withdrawArbiterFee(uint256 dealId) external override nonReentrant {
        DisputeLogic.executeWithdrawArbiterFee(address(usdc), dealId);
    }

    function retryArbiterFeeRefund(uint256 dealId) external override nonReentrant {
        DisputeLogic.executeRetryArbiterFeeRefund(address(usdc), dealId);
    }

    function retryCascadeRefund(uint256 dealId, uint8 milestoneIndex) external override nonReentrant {
        ClaimLogic.executeRetryCascadeRefund(address(usdc), address(_registryContract), dealId, milestoneIndex);
    }

    // -------------------------------------------------------------------------
    // Dispute / resolve
    // -------------------------------------------------------------------------

    function dispute(uint256 dealId, uint8 milestoneIndex, bytes32 evidenceHash) external override {
        DisputeLogic.executeDispute(dealId, milestoneIndex, evidenceHash);
    }

    function respondToDispute(uint256 dealId, uint8 milestoneIndex, bytes32 evidenceHash) external override {
        DisputeLogic.executeRespondToDispute(dealId, milestoneIndex, evidenceHash);
    }

    function appendDisputeEvidence(uint256 dealId, uint8 milestoneIndex, bytes32 evidenceHash) external override {
        DisputeLogic.executeAppendDisputeEvidence(dealId, milestoneIndex, evidenceHash);
    }

    function withdrawDispute(uint256 dealId, uint8 milestoneIndex) external override {
        DisputeLogic.executeWithdrawDispute(dealId, milestoneIndex);
    }

    function waiveRebuttal(uint256 dealId, uint8 milestoneIndex) external override {
        DisputeLogic.executeWaiveRebuttal(dealId, milestoneIndex);
    }

    function resolve(uint256 dealId, uint8 milestoneIndex, bool toSupplier) external override nonReentrant {
        DisputeLogic.executeResolve(address(usdc), address(_registryContract), dealId, milestoneIndex, toSupplier);
    }

    function resolveSplit(uint256 dealId, uint8 milestoneIndex, uint16 supplierBps) external override nonReentrant {
        DisputeLogic.executeResolveSplit(address(usdc), address(_registryContract), dealId, milestoneIndex, supplierBps);
    }

    function applyDefault(uint256 dealId, uint8 milestoneIndex) external override nonReentrant {
        DisputeLogic.executeApplyDefault(address(usdc), address(_registryContract), dealId, milestoneIndex);
    }

    /// @notice (04h) Cast a 2-of-3 panel vote on a disputed milestone.
    function castPanelVote(uint256 dealId, uint8 milestoneIndex, uint32 vote) external override nonReentrant {
        DisputeLogic.executeCastPanelVote(address(usdc), address(_registryContract), dealId, milestoneIndex, vote);
    }

    // -------------------------------------------------------------------------
    // Address-change delay (03d)
    // -------------------------------------------------------------------------

    function proposePayout(uint256 dealId, address newAddr) external override {
        DisputeLogic.executeProposePayout(dealId, newAddr);
    }

    function rejectPayoutChange(uint256 dealId) external override {
        DisputeLogic.executeRejectPayoutChange(dealId);
    }

    function applyPayoutChange(uint256 dealId) external override {
        DisputeLogic.executeApplyPayoutChange(dealId);
    }

    function proposeRefundAddress(uint256 dealId, address newAddr) external override {
        DisputeLogic.executeProposeRefundAddress(dealId, newAddr);
    }

    function rejectRefundChange(uint256 dealId) external override {
        DisputeLogic.executeRejectRefundChange(dealId);
    }

    function applyRefundChange(uint256 dealId) external override {
        DisputeLogic.executeApplyRefundChange(dealId);
    }

    // -------------------------------------------------------------------------
    // Admin (pause + timelocks)
    // -------------------------------------------------------------------------

    function pauseNewDeals() external override {
        AdminLogic.executePauseNewDeals(pauser);
    }

    function unpauseNewDeals() external override {
        AdminLogic.executeUnpauseNewDeals(pauser);
    }

    function addArbiter(address) external pure override {
        revert DirectParamChange();
    }

    function removeArbiter(address) external pure override {
        revert DirectParamChange();
    }

    function scheduleSetTreasury(address newTreasury) external override {
        AdminLogic.executeScheduleSetTreasury(pauser, newTreasury);
    }

    function executeSetTreasury() external override {
        AdminLogic.executeSetTreasury(pauser);
    }

    function scheduleSetFeeBpsRange(uint16 minBps, uint16 maxBps) external override {
        AdminLogic.executeScheduleSetFeeBpsRange(pauser, minBps, maxBps);
    }

    function executeSetFeeBpsRange() external override {
        AdminLogic.executeSetFeeBpsRange(pauser);
    }

    function lowerCaps(uint256 newMaxDealAmount, uint256 newMaxLocked) external override {
        AdminLogic.executeLowerCaps(pauser, newMaxDealAmount, newMaxLocked);
    }

    function scheduleRaiseCaps(uint256 newMaxDealAmount, uint256 newMaxLocked) external override {
        AdminLogic.executeScheduleRaiseCaps(pauser, newMaxDealAmount, newMaxLocked);
    }

    function executeRaiseCaps() external override {
        AdminLogic.executeRaiseCaps(pauser);
    }

    function getPendingCaps() external view override returns (uint256 newMaxDealAmount, uint256 newMaxLocked, uint64 eta) {
        WaybillStorage.PendingCaps memory p = _layout().pendingCaps;
        return (p.maxDealAmount, p.maxLocked, p.eta);
    }

    // -------------------------------------------------------------------------
    // View functions (delegated to ViewLogic via STATICCALL)
    // -------------------------------------------------------------------------

    function getDeal(uint256 dealId) external view override returns (Deal memory) {
        return ViewLogic.getDeal(dealId);
    }

    function getMilestone(uint256 dealId, uint8 milestoneIndex) external view override returns (Milestone memory) {
        return ViewLogic.getMilestone(dealId, milestoneIndex);
    }

    function getAttestors(uint256 dealId, uint8 milestoneIndex) external view override returns (address[] memory) {
        return ViewLogic.getAttestors(dealId, milestoneIndex);
    }

    function getThreshold(uint256 dealId, uint8 milestoneIndex) external view override returns (uint8) {
        return ViewLogic.getThreshold(dealId, milestoneIndex);
    }

    function getTrancheFee(uint256 dealId, uint8 milestoneIndex) external view override returns (uint256) {
        return ViewLogic.getTrancheFee(dealId, milestoneIndex);
    }

    function isFullyAccepted(uint256 dealId) external view override returns (bool) {
        return ViewLogic.isFullyAccepted(dealId);
    }

    function feeBalance(address account) external view override returns (uint256) {
        return ViewLogic.feeBalance(account);
    }

    function arbiterFeeBalance(address arbiter) external view override returns (uint256) {
        return _layout().arbiterFeeBalances[arbiter];
    }

    function arbiterFeeRefundPending(uint256 dealId) external view override returns (uint256) {
        return _layout().arbiterFeeRefundPending[dealId];
    }
    function cascadeRefundPending(uint256 dealId, uint8 milestoneIndex) external view override returns (uint256) {
        return _layout().cascadeRefundPending[dealId][milestoneIndex];
    }
    function dependsOnMilestone(uint256 dealId, uint8 milestoneIndex) external view override returns (uint16) {
        return _layout().milestoneDependsOn[dealId][milestoneIndex];
    }

    function getDisputeResponse(uint256 dealId, uint8 milestoneIndex) external view override returns (bytes32) {
        return ViewLogic.getDisputeResponse(dealId, milestoneIndex);
    }

    function getDisputeEvidence(uint256 dealId, uint8 milestoneIndex) external view override returns (bytes32[] memory) {
        return _layout().disputeEvidence[dealId][milestoneIndex];
    }

    function getDisputeEvidenceCount(uint256 dealId, uint8 milestoneIndex) external view override returns (uint256) {
        return _layout().disputeEvidence[dealId][milestoneIndex].length;
    }

    function getPendingPayoutChange(uint256 dealId) external view override returns (PendingAddressChange memory) {
        return ViewLogic.getPendingPayoutChange(dealId);
    }

    function getPendingRefundChange(uint256 dealId) external view override returns (PendingAddressChange memory) {
        return ViewLogic.getPendingRefundChange(dealId);
    }

    /// @notice (04g) Returns the fee-payer mode frozen at funding time.
    function getDealFeePayer(uint256 dealId) external view override returns (FeePayer) {
        return _layout().deals[dealId].feePayer;
    }

    /// @notice (04h) Returns the 3 panel member addresses (all zero for single-arbiter).
    function getPanelMembers(uint256 dealId) external view override returns (address[3] memory) {
        WaybillStorage.Layout storage s = _layout();
        return [s.panelMembers[dealId][0], s.panelMembers[dealId][1], s.panelMembers[dealId][2]];
    }

    /// @notice (04h) Returns the encoded vote for a panel member on a given milestone (0 = not voted).
    function getPanelVote(uint256 dealId, uint8 milestoneIndex, address member) external view override returns (uint32) {
        return _layout().panelVotes[dealId][milestoneIndex][member];
    }

    /// @inheritdoc IWaybillEscrow
    function getDecisionOpensAt(uint256 dealId, uint8 milestoneIndex) external view override returns (uint64) {
        return _layout().decisionOpensAt[dealId][milestoneIndex];
    }

    /// @notice (04h) True if this deal uses a 3-member panel.
    function isPanelDeal(uint256 dealId) external view override returns (bool) {
        return _layout().panelMembers[dealId][0] != address(0);
    }

    function getPendingTreasury() external view override returns (address proposed, uint64 eta) {
        return ViewLogic.getPendingTreasury();
    }

    function getPendingFeeBpsRange() external view override returns (uint16 _minBps, uint16 _maxBps, uint64 eta) {
        return ViewLogic.getPendingFeeBpsRange();
    }

    // -------------------------------------------------------------------------
    // Compatibility shims
    // -------------------------------------------------------------------------

    function arbiterAllowed(address a) public view returns (bool) {
        return _arbiterListContract.isAllowed(a);
    }

    function arbiterList() external view override returns (address) {
        return address(_arbiterListContract);
    }

    function attestorRegistry() external view override returns (address) {
        return address(_registryContract);
    }
}
