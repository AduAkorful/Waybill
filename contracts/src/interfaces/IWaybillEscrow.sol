// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IWaybillEscrow — canonical ABI surface
/// @notice Enums, structs, custom errors, events, and external function signatures.
///         Off-chain clients and tests bind to this file. WaybillEscrow.sol inherits it.
interface IWaybillEscrow {
    // -------------------------------------------------------------------------
    // Enums
    // -------------------------------------------------------------------------

    enum DealState {
        PROPOSED,
        ACCEPTED,
        FUNDED,
        SETTLED,
        CANCELLED
    }

    enum MilestoneState {
        WAITING,
        IN_REVIEW,
        CLAIMABLE,
        RELEASED,
        OVERDUE,
        REFUNDABLE,
        REFUNDED,
        DISPUTED,
        RESOLVED
    }

    enum ReleaseCondition {
        ACCEPTANCE,
        ATTESTATION,
        BUYER_APPROVAL,
        TIMED
    }

    /// @notice (04g) Who pays the protocol fee.
    /// BuyerPrepaid    = 0 — buyer deposits principal + full fee; refund returns both.
    /// SupplierDeducted = 1 — buyer deposits principal only; fee deducted from supplier on release; refund returns principal only.
    /// Split           = 2 — buyer deposits principal + buyer half of fee; supplier deducted for the other half on release; refund returns principal + buyer half.
    enum FeePayer {
        BuyerPrepaid,
        SupplierDeducted,
        Split
    }

    // -------------------------------------------------------------------------
    // Structs
    // -------------------------------------------------------------------------

    /// @notice Input struct for milestone creation.
    /// @param attestors  For ATTESTATION milestones: 1–5 unique signers (not buyer/supplier/arbiter).
    ///                   For all other conditions: must be empty.
    /// @param threshold  For ATTESTATION: 1 <= threshold <= attestors.length.
    ///                   For all other conditions: must be 0.
    /// @param dependsOn  (04f) Index of a prerequisite milestone that must be RELEASED before this
    ///                   milestone's tranche can be claimed or approved. Must be a strictly earlier
    ///                   index (< this milestone's own index). Use type(uint16).max for independent.
    struct MilestoneInput {
        uint256 bps;
        ReleaseCondition condition;
        address[] attestors;
        uint8 threshold;
        uint64 deadline;
        uint32 gracePeriod;
        uint32 reviewWindow;
        uint16 dependsOn;   // (04f) type(uint16).max == independent
    }

    struct Milestone {
        uint256 bps;
        ReleaseCondition condition;
        /// @notice First attestor address (for fee attribution on 40% split).
        ///         address(0) for non-ATTESTATION milestones.
        address attestor;
        uint64 deadline;
        uint32 gracePeriod;
        uint32 reviewWindow;
        MilestoneState state;
        bool attestorAccepted;  // true once ALL attestors have accepted
        bool attested;          // true once threshold has been reached
        bytes32 evidenceHash;
        bool disputed;
        bool buyerRaisedDispute;
        uint64 reviewWindowStart;
        uint64 arbiterDeadline;
        uint8 threshold;        // required attestation count
        uint8 attestCount;      // how many unique attestors have attested so far
        // Dispute response fields (03c)
        address disputeRaiser;
        uint64 disputeTime;
        bytes32 disputeEvidenceHash;
        uint64 responseDeadline;
        bytes32 responseHash;
        bool responseSubmitted;
    }

    /// @notice Pending delayed address-change proposal (payout or refund).
    struct PendingAddressChange {
        address proposed; // address(0) means no pending change
        uint64 eta;       // earliest timestamp the change can be applied
    }

    struct Deal {
        address buyer;
        address supplier;
        address supplierPayout;
        address buyerRefund;
        address arbiter;
        DealState state;
        uint256 totalAmount;
        uint256 prepaidFee;
        uint16 feeBps;
        uint8 milestoneCount;
        uint64 acceptanceDeadline;
        uint64 arbiterDeadlineHours;
        bool arbiterAccepted;
        bool newDealPaused;
        bool settled;
        uint32 responsePeriodHours; // fixed 72 — set in createDeal
        address protocolTreasury;   // snapshot of treasury at createDeal time; fee accruals for this deal always go here
        bool fundFirst;             // if true, buyer may fund before all accepts; accepts still required before claim
        uint256 arbiterFee;         // (04c) fixed USDC amount pre-paid by buyer at fund; paid to arbiter on first timely resolve, else refunded to buyer
        FeePayer feePayer;          // (04g) who pays the protocol fee; BuyerPrepaid by default
    }

    // -------------------------------------------------------------------------
    // Custom errors
    // -------------------------------------------------------------------------

    // Construction / admin
    error NotPauser();
    error UsdcZeroAddress();
    error UsdcNotContract();
    error TreasuryZeroAddress();
    error PauserZeroAddress();
    error ZeroMaxDealAmount();
    error ZeroMaxLocked();
    error ArbiterZeroAddress();

    // createDeal validation
    error NewDealsPausedError();
    error SupplierZeroAddress();
    error BuyerRefundZeroAddress();
    error ArbiterNotAllowed();
    error ArbiterIsBuyer();
    error ArbiterIsSupplier();
    error InvalidTotal();
    error InvalidFeeBps();
    error InvalidAcceptanceDeadline();
    error InvalidArbiterHours();
    error InvalidMilestoneCount();
    error MaxLockedExceeded();
    // Attestor validation
    error AttestorRequired();
    error TooManyAttestors();
    error DuplicateAttestor();
    error AttestorIsArbiter();
    error AttestorIsBuyer();
    error AttestorIsSupplier();
    /// @notice Rejected attestor has Suspended status in the AttestorRegistry.
    error AttestorSuspended();
    error InvalidThreshold();
    error AttestorsNotEmpty();   // non-ATTESTATION milestone supplied attestors
    error InvalidBpsSum();

    // State-machine guards
    error DealMissing();
    error InvalidDealState();
    error AcceptanceExpired();
    error AcceptanceNotExpired();
    error AlreadyAccepted();
    error NotSupplier();
    error NotAttestor();
    error NotArbiter();
    error NotBuyer();
    error NotParticipant();
    error NotFullyAccepted();

    // Milestone guards
    error InvalidMilestone();
    error NotAttestationMilestone();
    error NotBuyerApproval();
    error InvalidMilestoneState();

    // Attestation guards
    error AlreadyAttested();        // this specific signer already attested this milestone
    error AttestorAlreadyAccepted(); // acceptAttestor called twice by same address
    error SignatureExpired();
    error InvalidSignedAt();
    error AttestationUsed();
    error InvalidSigner();

    // Timing
    error GraceExpired();
    error GraceActive();
    error TimedNotReached();
    error ReviewActive();
    error ArbiterDeadlinePassed();
    error ArbiterDeadlineActive();

    // Dispute/resolve
    error BuyerDisputeNotInReview();
    error SupplierDisputeNotOverdue();
    error NotDisputed();
    error Disputed();
    error NoDefaultPath();
    error NotDisputeResponder();      // caller is not the OTHER party
    error ResponseWindowClosed();     // past responseDeadline
    error ResponseAlreadySubmitted(); // respondToDispute called twice
    error InvalidSplitBps();          // supplierBps > 10000
    error SplitTransferFailed();      // either leg of a partial resolveSplit transfer failed
    error ResponseWindowOpen();       // (04d) arbiter tried to resolve while response window is still active
    error RebuttalWindowOpen();       // (33) a response was filed; the raiser's rebuttal time has not ended or been waived
    error NotDisputeRaiser();         // (33) only the party who raised the dispute may waive the rebuttal
    error NoResponseYet();            // (33) nothing to rebut: the other side has not responded
    error RebuttalAlreadyOver();      // (33) decisions are already open
    error EvidenceHashZero();         // (04d) bytes32(0) rejected as dispute evidence
    error NotBuyerRaisedDispute();    // (04d) withdrawDispute called but buyer did not raise this dispute
    error DisputeAlreadyWithdrawn();  // (04d) withdrawDispute called on a non-DISPUTED milestone

    // Claim/refund
    error NotClaimable();
    error NotRefundable();
    error RefundTransferFailed();
    error SupplierNotAccepted(); // claim() when supplierPayout not yet set (fundFirst deal)

    // Address-change delay (03d)
    error NoPendingChange();      // apply/reject called with no proposal outstanding
    error ChangeDelayActive();    // apply called before eta
    error ZeroAddressProposal();  // proposed address is zero
    error NotSupplierForPayout(); // proposePayout: caller is not the deal's supplier
    error NotBuyerForPayout();    // rejectPayoutChange: caller is not the buyer
    error NotBuyerForRefund();    // proposeRefundAddress: caller is not the buyer
    error NotSupplierForRefund(); // rejectRefundChange: caller is not the supplier

    // Parameter timelock (03e)
    error DirectParamChange();    // addArbiter/removeArbiter called directly (use schedule/execute)
    error InvalidFeeBpsRange();   // min > max or values outside 1–10000

    // Registry (03h)
    error RegistryZeroAddress();
    error RegistryNotContract();

    // Fee withdrawal
    error NoFees();

    // Arbiter fee (04c)
    error ArbiterFeeAlreadyMoved();  // second resolve/default/settle tried to move the same arbiter fee
    error ArbiterFeeRefundNotPending(); // retryArbiterFeeRefund called with no pending refund

    // Timeout cascade (04e)
    error CascadeRefundNotPending();   // retryCascadeRefund called with nothing pending
    error CascadeAlreadyRefunded();    // milestone already REFUNDED, retry not needed

    // Dependent milestones (04f)
    error InvalidDependsOn();          // dependsOn >= milestoneIndex (self / forward / out-of-range)
    error DependencyNotReleased();     // prerequisite milestone is not yet RELEASED

    // Fee-payer mode (04g)
    error InvalidFeePayer();           // enum value > 2

    // Panel arbitration (04h)
    error InvalidPanelSize();          // panel must be exactly 3 addresses or empty
    error PanelMemberZero();           // panel member address is zero
    error PanelMemberDuplicate();      // duplicate address in panel
    error PanelMemberNotAllowed();     // panel member not on the arbiter allow-list
    error PanelMemberIsBuyer();        // panel member is the buyer
    error PanelMemberIsSupplier();     // panel member is the supplier
    error NotPanelMember();            // caller is not a member of this deal's panel
    error PanelMemberIsAttestor();     // panel member appears as an attestor in a milestone
    error NotSingleArbiter();          // resolve/resolveSplit called on a panel deal
    error IsPanelDeal();               // castPanelVote called on a single-arbiter deal
    error AlreadyVoted();              // this panel member already cast a vote on this milestone
    error VoteAfterResolution();       // milestone is no longer DISPUTED
    error InvalidVoteEncoding();       // vote value is 3 (reserved) or > 10003

    // Registry resilience (H-1)
    event RegistryWriteFailed(uint256 indexed dealId, address indexed attestor);

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    event DealCreated(
        uint256 indexed dealId,
        address indexed buyer,
        address indexed supplier,
        address arbiter,
        uint256 totalAmount,
        uint16 feeBps
    );
    event SupplierAccepted(uint256 indexed dealId, address supplier, address payoutAddress);
    event AttestorAccepted(uint256 indexed dealId, uint8 milestoneIndex, address attestor);
    event ArbiterAccepted(uint256 indexed dealId, address arbiter);
    event DealFunded(uint256 indexed dealId, uint256 totalAmount, uint256 prepaidFee);
    event AttestationSubmitted(
        uint256 indexed dealId, uint8 indexed milestoneIndex, address attestor, bytes32 evidenceHash
    );
    event ThresholdMet(uint256 indexed dealId, uint8 indexed milestoneIndex, uint8 threshold);
    event ReviewWindowStarted(
        uint256 indexed dealId, uint8 indexed milestoneIndex, uint64 startedAt, uint32 windowHours
    );
    event MilestoneApprovedEarly(uint256 indexed dealId, uint8 indexed milestoneIndex);
    event MilestoneClaimable(uint256 indexed dealId, uint8 indexed milestoneIndex);
    event TrancheClaimed(uint256 indexed dealId, uint8 indexed milestoneIndex, address recipient, uint256 amount);
    event PayoutFailed(uint256 indexed dealId, uint8 indexed milestoneIndex, address recipient, uint256 amount);
    event DisputeRaised(uint256 indexed dealId, uint8 indexed milestoneIndex, address raiser, bytes32 evidenceHash);
    event DisputeResponseAdded(uint256 indexed dealId, uint8 indexed milestoneIndex, address responder, bytes32 evidenceHash);
    /// @notice A response re-anchors the arbiter's deadline; indexers and alerts must use this value from now on
    /// @notice (33) A response (or the raiser's waiver) set when decisions open and the arbiter's new deadline
    event DecisionWindowSet(uint256 indexed dealId, uint8 indexed milestoneIndex, uint64 decisionOpensAt, uint64 arbiterDeadline);
    /// @notice (33) The party who raised the dispute gave up the rest of their rebuttal time
    event RebuttalWaived(uint256 indexed dealId, uint8 indexed milestoneIndex, address raiser);
    // (04d)
    event DisputeEvidenceAppended(uint256 indexed dealId, uint8 indexed milestoneIndex, address indexed submitter, bytes32 evidenceHash, uint256 index);
    event DisputeWithdrawn(uint256 indexed dealId, uint8 indexed milestoneIndex, address buyer);
    event DisputeResolved(uint256 indexed dealId, uint8 indexed milestoneIndex, address arbiter, bool toSupplier);
    event TrancheSplit(uint256 indexed dealId, uint8 indexed milestoneIndex, uint16 supplierBps, uint256 supplierAmount, uint256 buyerAmount);
    event DefaultApplied(uint256 indexed dealId, uint8 indexed milestoneIndex, bool toSupplier);
    event TrancheRefunded(
        uint256 indexed dealId,
        uint8 indexed milestoneIndex,
        address recipient,
        uint256 amount,
        uint256 feeRefunded
    );
    event RefundFailed(uint256 indexed dealId, uint8 indexed milestoneIndex, address recipient, uint256 amount);
    // (04e) cascade refund events
    event CascadeRefunded(uint256 indexed dealId, uint8 indexed milestoneIndex, address recipient, uint256 amount, uint256 feeRefunded);
    event CascadeRefundPending(uint256 indexed dealId, uint8 indexed milestoneIndex, address blockedRecipient, uint256 amount);
    event CascadeRefundRetried(uint256 indexed dealId, uint8 indexed milestoneIndex, address recipient, uint256 amount);
    event MilestoneRefundable(uint256 indexed dealId, uint8 milestoneIndex);
    event DealSettled(uint256 indexed dealId);
    event DealCancelled(uint256 indexed dealId);
    event FeesWithdrawn(address indexed recipient, uint256 amount);
    // Arbiter fee (04c)
    event ArbiterFeeCredited(uint256 indexed dealId, address indexed arbiter, uint256 amount);
    event ArbiterFeeRefunded(uint256 indexed dealId, address indexed recipient, uint256 amount);
    // H-04c-2: emitted when buyer-refund transfer fails; fee is retryable
    event ArbiterFeeRefundPending(uint256 indexed dealId, address indexed blockedRecipient, uint256 amount);
    // Panel arbitration (04h)
    event PanelMemberAccepted(uint256 indexed dealId, address indexed member);
    event PanelVoteCast(uint256 indexed dealId, uint8 indexed milestoneIndex, address indexed member, uint32 vote);
    event PanelResolved(uint256 indexed dealId, uint8 indexed milestoneIndex, uint32 winningVote);

    event NewDealsPaused();
    event NewDealsUnpaused();
    event ArbiterAdded(address indexed arbiter);
    event ArbiterRemoved(address indexed arbiter);
    // Parameter timelock (03e)
    event AddArbiterScheduled(address indexed arbiter, uint64 eta);
    event AddArbiterExecuted(address indexed arbiter);
    event RemoveArbiterScheduled(address indexed arbiter, uint64 eta);
    event RemoveArbiterExecuted(address indexed arbiter);
    event SetTreasuryScheduled(address indexed proposed, uint64 eta);
    event SetTreasuryExecuted(address indexed oldTreasury, address indexed newTreasury);
    event SetFeeBpsRangeScheduled(uint16 minBps, uint16 maxBps, uint64 eta);
    event SetFeeBpsRangeExecuted(uint16 minBps, uint16 maxBps);
    // Address-change delay (03d)
    event PayoutChangeProposed(uint256 indexed dealId, address oldAddr, address newAddr, uint64 eta);
    event PayoutChangeRejected(uint256 indexed dealId, address rejected);
    event PayoutChangeApplied(uint256 indexed dealId, address oldAddr, address newAddr);
    event RefundChangeProposed(uint256 indexed dealId, address oldAddr, address newAddr, uint64 eta);
    event RefundChangeRejected(uint256 indexed dealId, address rejected);
    event RefundChangeApplied(uint256 indexed dealId, address oldAddr, address newAddr);

    // -------------------------------------------------------------------------
    // External functions
    // -------------------------------------------------------------------------

    function createDeal(
        address supplier,
        address buyerRefund,
        address arbiter,
        uint256 totalAmount,
        uint16 feeBps,
        uint64 acceptanceDeadlineTs,
        uint32 arbiterDeadlineHours,
        MilestoneInput[] calldata milestoneInputs
    ) external returns (uint256 dealId);

    /// @notice Fund-first variant: buyer may fund before all parties accept.
    ///         Accepts are still required before claim() succeeds.
    function createDeal(
        address supplier,
        address buyerRefund,
        address arbiter,
        uint256 totalAmount,
        uint16 feeBps,
        uint64 acceptanceDeadlineTs,
        uint32 arbiterDeadlineHours,
        MilestoneInput[] calldata milestoneInputs,
        bool fundFirst
    ) external returns (uint256 dealId);

    /// @notice (04c) Variant with a fixed arbiterFee in USDC token units (6 decimals).
    ///         The buyer pre-pays it at fund(); it is held until first timely resolve
    ///         (credited to the arbiter) or no-dispute settle / default (refunded to buyer).
    function createDeal(
        address supplier,
        address buyerRefund,
        address arbiter,
        uint256 totalAmount,
        uint16 feeBps,
        uint64 acceptanceDeadlineTs,
        uint32 arbiterDeadlineHours,
        MilestoneInput[] calldata milestoneInputs,
        bool fundFirst,
        uint256 arbiterFee
    ) external returns (uint256 dealId);

    /// @notice (04g) Variant that explicitly sets who pays the protocol fee.
    ///         BuyerPrepaid (default) — buyer deposits principal + full fee.
    ///         SupplierDeducted       — buyer deposits principal only; fee deducted from supplier payout.
    ///         Split                  — buyer deposits principal + buyer half; supplier deducted for other half.
    ///         The fixed arbiter fee (04c) is ALWAYS buyer-prepaid regardless of feePayer.
    function createDeal(
        address supplier,
        address buyerRefund,
        address arbiter,
        uint256 totalAmount,
        uint16 feeBps,
        uint64 acceptanceDeadlineTs,
        uint32 arbiterDeadlineHours,
        MilestoneInput[] calldata milestoneInputs,
        bool fundFirst,
        uint256 arbiterFee,
        FeePayer feePayer
    ) external returns (uint256 dealId);

    /// @notice (04h) Panel-arbitration variant.
    ///         panel == empty array: legacy single-arbiter path; `arbiter` must be a valid allow-listed
    ///         address (identical behaviour to the 04g createDeal overload).
    ///         panel == exactly 3 distinct non-zero allow-listed addresses (not buyer, not supplier,
    ///         not any attestor): panel deal; `arbiter` is ignored (pass address(0) or any value).
    ///         Any other panel length reverts InvalidPanelSize.
    ///         All other semantics (fee-payer, arbiter-fee, fund-first) carry over unchanged.
    function createDealWithPanel(
        address supplier,
        address buyerRefund,
        address arbiter,
        address[] calldata panel,
        uint256 totalAmount,
        uint16 feeBps,
        uint64 acceptanceDeadlineTs,
        uint32 arbiterDeadlineHours,
        MilestoneInput[] calldata milestoneInputs,
        bool fundFirst,
        uint256 arbiterFee,
        FeePayer feePayer
    ) external returns (uint256 dealId);

    function acceptSupplier(uint256 dealId, address payoutAddress) external;
    function acceptAttestor(uint256 dealId, uint8 milestoneIndex) external;
    function acceptArbiter(uint256 dealId) external;
    function cancelUnaccepted(uint256 dealId) external;
    function fund(uint256 dealId) external;

    function attest(
        uint256 dealId,
        uint8 milestoneIndex,
        bytes32 evidenceHash,
        uint64 signedAt,
        uint64 expiry,
        address signer,
        bytes calldata signature
    ) external;

    function approveMilestone(uint256 dealId, uint8 milestoneIndex) external;
    function dispute(uint256 dealId, uint8 milestoneIndex, bytes32 evidenceHash) external;
    function respondToDispute(uint256 dealId, uint8 milestoneIndex, bytes32 evidenceHash) external;
    /// @notice (04d) Append an immutable evidence hash to the on-chain dispute record.
    ///         Only buyer or supplier may call while milestone is DISPUTED and before arbiterDeadline.
    function appendDisputeEvidence(uint256 dealId, uint8 milestoneIndex, bytes32 evidenceHash) external;
    /// @notice (04d) Buyer may withdraw their own dispute, returning the milestone to CLAIMABLE.
    ///         Only valid while DISPUTED, buyerRaisedDispute is true, and before resolution/default.
    function withdrawDispute(uint256 dealId, uint8 milestoneIndex) external;
    /// @notice (33) The party who raised the dispute ends their rebuttal time early, so the arbiter may decide now.
    function waiveRebuttal(uint256 dealId, uint8 milestoneIndex) external;
    function resolve(uint256 dealId, uint8 milestoneIndex, bool toSupplier) external;
    function resolveSplit(uint256 dealId, uint8 milestoneIndex, uint16 supplierBps) external;
    /// @notice (04h) Cast a panel vote on a disputed milestone.
    ///         vote encoding: 1=toBuyer, 2=toSupplier, 4..10002=split (supplierBps = vote - 3).
    ///         Value 0 and 3 are reserved and revert InvalidVoteEncoding.
    ///         When two votes match the resolution executes atomically.
    function castPanelVote(uint256 dealId, uint8 milestoneIndex, uint32 vote) external;
    function applyDefault(uint256 dealId, uint8 milestoneIndex) external;
    function claim(uint256 dealId, uint8 milestoneIndex) external;
    function refund(uint256 dealId, uint8 milestoneIndex) external;
    function withdrawFees() external;
    /// @notice (04c) Pull pending arbiter fee for a specific deal. Only callable by the deal's arbiter.
    function withdrawArbiterFee(uint256 dealId) external;
    /// @notice (H-04c-2) Retry a previously-failed arbiter-fee refund to the buyer.
    ///         Callable by anyone; transfer goes to current deal.buyerRefund.
    ///         Reverts RefundTransferFailed if buyerRefund is still blocked.
    function retryArbiterFeeRefund(uint256 dealId) external;
    /// @notice (04e) Retry a cascade-refund tranche whose buyer transfer previously failed.
    ///         Callable by anyone. Transfer goes to current deal.buyerRefund.
    ///         Reverts CascadeRefundNotPending if nothing is pending for this milestone.
    function retryCascadeRefund(uint256 dealId, uint8 milestoneIndex) external;
    function pauseNewDeals() external;
    function unpauseNewDeals() external;
    function addArbiter(address arbiter) external;      // reverts DirectParamChange — use schedule/execute
    function removeArbiter(address arbiter) external;   // reverts DirectParamChange — use schedule/execute

    // Parameter timelock (03e) — arbiter add/remove moved to ArbiterList; treasury/fee range remain here
    function scheduleSetTreasury(address newTreasury) external;
    function executeSetTreasury() external;
    function scheduleSetFeeBpsRange(uint16 minBps, uint16 maxBps) external;
    function executeSetFeeBpsRange() external;

    // Address-change delay (03d)
    function proposePayout(uint256 dealId, address newAddr) external;
    function rejectPayoutChange(uint256 dealId) external;
    function applyPayoutChange(uint256 dealId) external;
    function proposeRefundAddress(uint256 dealId, address newAddr) external;
    function rejectRefundChange(uint256 dealId) external;
    function applyRefundChange(uint256 dealId) external;

    // View functions
    function getDeal(uint256 dealId) external view returns (Deal memory);
    function getMilestone(uint256 dealId, uint8 milestoneIndex) external view returns (Milestone memory);
    function getAttestors(uint256 dealId, uint8 milestoneIndex) external view returns (address[] memory);
    function getThreshold(uint256 dealId, uint8 milestoneIndex) external view returns (uint8);
    function getTrancheFee(uint256 dealId, uint8 milestoneIndex) external view returns (uint256);
    function isFullyAccepted(uint256 dealId) external view returns (bool);
    function feeBalance(address account) external view returns (uint256);
    /// @notice (H-04c-3) Separate aggregate arbiter-fee ledger; never readable by withdrawFees().
    function arbiterFeeBalance(address arbiter) external view returns (uint256);
    /// @notice (H-04c-2) Amount of arbiter fee pending refund to buyer (non-zero if prior transfer failed).
    function arbiterFeeRefundPending(uint256 dealId) external view returns (uint256);
    /// @notice (04e) Amount of cascade-refund tranche pending delivery (non-zero if prior transfer failed).
    function cascadeRefundPending(uint256 dealId, uint8 milestoneIndex) external view returns (uint256);
    /// @notice (04f) Returns the prerequisite milestone index for the given milestone,
    ///         or type(uint16).max if the milestone is independent.
    function dependsOnMilestone(uint256 dealId, uint8 milestoneIndex) external view returns (uint16);
    function getDisputeResponse(uint256 dealId, uint8 milestoneIndex) external view returns (bytes32);
    /// @notice (04d) Returns all appended evidence hashes for a disputed milestone, in order.
    function getDisputeEvidence(uint256 dealId, uint8 milestoneIndex) external view returns (bytes32[] memory);
    /// @notice (04d) Returns the number of evidence hashes appended for a disputed milestone.
    function getDisputeEvidenceCount(uint256 dealId, uint8 milestoneIndex) external view returns (uint256);
    function getPendingPayoutChange(uint256 dealId) external view returns (PendingAddressChange memory);
    function getPendingRefundChange(uint256 dealId) external view returns (PendingAddressChange memory);
    /// @notice (04g) Returns the fee-payer mode frozen at funding time.
    function getDealFeePayer(uint256 dealId) external view returns (FeePayer);
    /// @notice (04h) Returns the 3 panel member addresses for a panel deal, or [0,0,0] for single-arbiter.
    function getPanelMembers(uint256 dealId) external view returns (address[3] memory);
    /// @notice (04h) Returns the encoded vote cast by a panel member for a milestone (0 = not voted).
    function getPanelVote(uint256 dealId, uint8 milestoneIndex, address member) external view returns (uint32);
    /// @notice (33) When decisions open on a responded dispute (0 while there is no response).
    function getDecisionOpensAt(uint256 dealId, uint8 milestoneIndex) external view returns (uint64);
    /// @notice (04h) Returns true if this deal uses a 3-member panel instead of a single arbiter.
    function isPanelDeal(uint256 dealId) external view returns (bool);
    // 03e / 03g views
    function treasury() external view returns (address);
    function minFeeBps() external view returns (uint16);
    function maxFeeBps() external view returns (uint16);
    function arbiterList() external view returns (address);        // 03g: the ArbiterList contract
    function attestorRegistry() external view returns (address);   // 03h: the AttestorRegistry contract
    function getPendingTreasury() external view returns (address proposed, uint64 eta);
    function getPendingFeeBpsRange() external view returns (uint16 minBps, uint16 maxBps, uint64 eta);
}
