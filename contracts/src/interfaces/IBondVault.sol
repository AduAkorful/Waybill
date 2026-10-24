// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IBondVault — attestor bond vault ABI surface.
/// @notice Holds USDC deposited by attestors. Slash goes to the harmed party named
///         by the arbiter. Never to pauser/treasury/operator. 72-hour appeal window.
///         The vault MUST NOT transferFrom the escrow contract.
///         The vault MUST NOT call claim/refund/fund/createDeal on the escrow.
interface IBondVault {
    // -------------------------------------------------------------------------
    // Structs
    // -------------------------------------------------------------------------

    struct Slash {
        uint256 dealId;
        uint8   milestoneIndex;
        address attestor;
        address harmed;
        uint256 amount;         // USDC amount locked for this slash
        uint64  eta;            // earliest timestamp executeSlash can be called
        bool    reversed;       // arbiter reversed before eta
        bool    executed;       // executeSlash already called
    }

    // -------------------------------------------------------------------------
    // Errors
    // -------------------------------------------------------------------------

    error NotPauser();
    error NotArbiter();
    error ZeroAddress();
    error ZeroAmount();
    error InvalidBps();
    error InsufficientBond();
    error HarmedNotParty();       // harmed must be deal.buyerRefund or deal.supplierPayout
    error HarmedForbidden();      // harmed is pauser, protocolTreasury, attestor, or vault itself
    error NotDisputedOrResolved();// milestone must be DISPUTED or RESOLVED
    error NotListedAttestor();    // attestor not in getAttestors(dealId, idx)
    error SlashPending();         // a pending slash already exists for (dealId, idx, attestor)
    error NoPendingSlash();       // no pending slash for this slashId
    error AppealActive();         // eta has not elapsed yet
    error AlreadyReversed();      // slash was already reversed
    error NotEscrow();            // caller is not the escrow (reserved for future guard use)
    error TransferFailed();       // USDC transfer failed

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    event BondDeposited(address indexed attestor, uint256 amount);
    event BondWithdrawn(address indexed attestor, uint256 amount);
    event SlashFlagged(
        uint256 indexed slashId,
        uint256 dealId,
        uint8   milestoneIndex,
        address attestor,
        address harmed,
        uint16  slashBps,
        uint256 amount,
        uint64  eta
    );
    event SlashReversed(uint256 indexed slashId);
    event SlashExecuted(uint256 indexed slashId, address harmed, uint256 amount);

    // -------------------------------------------------------------------------
    // Functions
    // -------------------------------------------------------------------------

    /// @notice Attestor deposits USDC into their free bond.
    ///         SafeERC20.safeTransferFrom(usdc, msg.sender, this, amount).
    ///         freeBond[msg.sender] += amount. amount must be > 0.
    function deposit(uint256 amount) external;

    /// @notice Withdraw from freeBond only. SafeERC20.safeTransfer to msg.sender.
    function withdraw(uint256 amount) external;

    /// @notice Arbiter flags negligent attestor for slashing.
    ///         Caller must be the deal's arbiter.
    ///         Deal must be FUNDED or SETTLED. Milestone must be DISPUTED or RESOLVED.
    ///         attestor must be in getAttestors(dealId, idx).
    ///         1 <= slashBps <= 10000. harmed != 0, != pauser, != protocolTreasury,
    ///         != attestor, != address(this); harmed must be buyerRefund or supplierPayout.
    ///         amount = freeBond[attestor] * slashBps / 10000. Reverts if 0.
    ///         Deducts freeBond. Stores pending slash. One pending per (dealId, idx, attestor).
    ///         Does NOT transfer yet. Does NOT record registry yet.
    function flagNegligent(
        uint256 dealId,
        uint8   milestoneIndex,
        address attestor,
        uint16  slashBps,
        address harmed
    ) external returns (uint256 slashId);

    /// @notice Arbiter reverses a pending slash before the appeal window elapses.
    ///         Restores amount to freeBond[attestor]. Marks reversed.
    function reverseFlag(uint256 slashId) external;

    /// @notice Anyone may execute after eta. Not reversed. Transfers USDC to harmed.
    ///         Then calls registry.recordOutcome(attestor, Slashed) and
    ///         registry.recordOutcome(attestor, Upheld).
    ///         If registry reverts, the whole tx reverts.
    function executeSlash(uint256 slashId) external;

    // -------------------------------------------------------------------------
    // Views
    // -------------------------------------------------------------------------

    function usdc()       external view returns (address);
    function escrow()     external view returns (address);
    function registry()   external view returns (address);
    function pauser()     external view returns (address);
    function freeBond(address attestor) external view returns (uint256);
    function getSlash(uint256 slashId) external view returns (Slash memory);
    function nextSlashId() external view returns (uint256);
}
