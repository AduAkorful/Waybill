// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IFinancingVault} from "../interfaces/IFinancingVault.sol";
import {IWaybillEscrow} from "../interfaces/IWaybillEscrow.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title FinancingVault — unsecured USDC loan pool against Waybill deals.
/// @notice Lenders deposit idle USDC. Suppliers borrow against a FUNDED deal.
///         Interest is credited pro-rata to lenders via a per-unit accumulator.
///         Vault NEVER calls transferFrom on the escrow, and NEVER calls
///         claim/refund/fund/createDeal. Vault NEVER changes escrow state.
contract FinancingVault is IFinancingVault, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // -------------------------------------------------------------------------
    // Constants
    // -------------------------------------------------------------------------

    uint16  public constant MAX_INTEREST_BPS = 2000;
    uint256 private constant INDEX_SCALE     = 1e18;

    // -------------------------------------------------------------------------
    // Immutables
    // -------------------------------------------------------------------------

    IERC20         public immutable _usdc;
    IWaybillEscrow public immutable _escrowContract;
    address        public immutable override pauser;

    // -------------------------------------------------------------------------
    // State — pool level
    // -------------------------------------------------------------------------

    /// @inheritdoc IFinancingVault
    uint256 public override freeLiquidity;

    /// @notice Sum of all lender principal deposits (never changes due to interest).
    uint256 private _totalPrincipal;

    /// @notice Global interest accumulator: interest earned per unit of principal
    ///         deposited, scaled by INDEX_SCALE.
    uint256 private _interestIndex;

    // -------------------------------------------------------------------------
    // State — per lender
    // -------------------------------------------------------------------------

    /// @notice Lender's deposited principal (unchanged by interest).
    mapping(address => uint256) private _lenderPrincipal;

    /// @notice Snapshot of _interestIndex at the time of the lender's last
    ///         deposit or interest settlement.
    mapping(address => uint256) private _lenderInterestSnapshot;

    /// @notice Accumulated pending interest for this lender (from settled
    ///         periods before their last deposit).
    mapping(address => uint256) private _lenderPendingInterest;

    // -------------------------------------------------------------------------
    // State — per loan
    // -------------------------------------------------------------------------

    struct Loan {
        address supplier;
        uint256 principal;
        uint16  interestBps;
        uint256 remaining;      // total still owed (principalRemaining + interestRemaining)
        uint256 principalPaid;  // how much of principal has been repaid so far
    }

    mapping(uint256 => Loan) private _loans;

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    constructor(address usdc_, address _pauser, address _escrow) {
        if (usdc_   == address(0)) revert ZeroAddress();
        if (_pauser == address(0)) revert ZeroAddress();
        if (_escrow == address(0)) revert ZeroAddress();
        if (usdc_.code.length   == 0) revert NotContract();
        if (_escrow.code.length == 0) revert NotContract();

        _usdc           = IERC20(usdc_);
        pauser          = _pauser;
        _escrowContract = IWaybillEscrow(_escrow);
    }

    // -------------------------------------------------------------------------
    // Views
    // -------------------------------------------------------------------------

    function usdc() external view override returns (address) {
        return address(_usdc);
    }

    function escrow() external view override returns (address) {
        return address(_escrowContract);
    }

    /// @inheritdoc IFinancingVault
    function lenderBalance(address lender) external view override returns (uint256) {
        return _lenderPrincipal[lender] + _pendingInterest(lender);
    }

    /// @inheritdoc IFinancingVault
    function lenderPrincipal(address lender) external view override returns (uint256) {
        return _lenderPrincipal[lender];
    }

    /// @inheritdoc IFinancingVault
    function getLoan(uint256 dealId)
        external
        view
        override
        returns (address supplier, uint256 principal, uint16 interestBps, uint256 remaining)
    {
        Loan storage l = _loans[dealId];
        return (l.supplier, l.principal, l.interestBps, l.remaining);
    }

    // -------------------------------------------------------------------------
    // Internal helpers
    // -------------------------------------------------------------------------

    /// @dev Pending interest earned by `lender` since their last snapshot.
    function _pendingInterest(address lender) private view returns (uint256) {
        uint256 principal = _lenderPrincipal[lender];
        if (principal == 0) return _lenderPendingInterest[lender];
        uint256 delta = _interestIndex - _lenderInterestSnapshot[lender];
        return _lenderPendingInterest[lender] + (principal * delta) / INDEX_SCALE;
    }

    /// @dev Flush pending interest into storage and snap the index.
    function _settleInterest(address lender) private {
        uint256 earned = _pendingInterest(lender);
        if (earned != _lenderPendingInterest[lender]) {
            _lenderPendingInterest[lender] = earned;
        }
        _lenderInterestSnapshot[lender] = _interestIndex;
    }

    /// @dev Credit `interestPaid` to the pool index pro-rata to deposited principal.
    ///      Called only from repay(); dust truncation stays in the contract.
    function _accrueInterest(uint256 interestPaid) private {
        if (interestPaid == 0 || _totalPrincipal == 0) return;
        _interestIndex += (interestPaid * INDEX_SCALE) / _totalPrincipal;
    }

    // -------------------------------------------------------------------------
    // Lender pool
    // -------------------------------------------------------------------------

    /// @inheritdoc IFinancingVault
    function deposit(uint256 amount) external override nonReentrant {
        if (amount == 0) revert ZeroAmount();
        // Settle existing interest before changing principal weight
        _settleInterest(msg.sender);
        _lenderPrincipal[msg.sender] += amount;
        _totalPrincipal              += amount;
        freeLiquidity                += amount;
        _usdc.safeTransferFrom(msg.sender, address(this), amount);
        emit LenderDeposited(msg.sender, amount);
    }

    /// @inheritdoc IFinancingVault
    function withdraw(uint256 amount) external override nonReentrant {
        if (amount == 0) revert ZeroAmount();

        // Settle and pull pending interest first
        _settleInterest(msg.sender);
        uint256 pendingInt = _lenderPendingInterest[msg.sender];
        uint256 principal  = _lenderPrincipal[msg.sender];

        // Total the lender is entitled to
        uint256 totalEntitled = principal + pendingInt;
        if (amount > totalEntitled) revert InsufficientLiquidity();
        if (amount > freeLiquidity) revert InsufficientLiquidity();

        // Deduct: interest first, then principal
        uint256 interestUsed;
        uint256 principalUsed;
        if (amount <= pendingInt) {
            interestUsed  = amount;
            principalUsed = 0;
        } else {
            interestUsed  = pendingInt;
            principalUsed = amount - pendingInt;
        }

        _lenderPendingInterest[msg.sender] -= interestUsed;
        _lenderPrincipal[msg.sender]       -= principalUsed;
        _totalPrincipal                    -= principalUsed;
        freeLiquidity                      -= amount;

        _usdc.safeTransfer(msg.sender, amount);
        emit LenderWithdrawn(msg.sender, amount);
    }

    // -------------------------------------------------------------------------
    // Loan lifecycle
    // -------------------------------------------------------------------------

    /// @inheritdoc IFinancingVault
    function borrow(uint256 dealId, uint256 amount, uint16 interestBps)
        external
        override
        nonReentrant
    {
        if (amount == 0)                revert ZeroAmount();
        if (interestBps > MAX_INTEREST_BPS) revert InterestCap();

        IWaybillEscrow.Deal memory deal = _escrowContract.getDeal(dealId);
        if (msg.sender != deal.supplier)                        revert NotSupplier();
        if (deal.state != IWaybillEscrow.DealState.FUNDED)      revert InvalidDealState();
        if (amount > deal.totalAmount)                          revert BorrowExceedsDeal();

        Loan storage loan = _loans[dealId];
        if (loan.supplier != address(0) && loan.remaining > 0)  revert LoanActive();

        if (amount > freeLiquidity) revert InsufficientLiquidity();

        uint256 interest  = (amount * interestBps) / 10_000;
        uint256 totalOwed = amount + interest;

        // CEI: update state before transfer
        loan.supplier    = msg.sender;
        loan.principal   = amount;
        loan.interestBps = interestBps;
        loan.remaining   = totalOwed;
        loan.principalPaid = 0;
        freeLiquidity   -= amount;

        _usdc.safeTransfer(msg.sender, amount);
        emit Borrowed(dealId, msg.sender, amount, interestBps, totalOwed);
    }

    /// @inheritdoc IFinancingVault
    function repay(uint256 dealId, uint256 amount) external override nonReentrant {
        if (amount == 0) revert ZeroAmount();
        Loan storage loan = _loans[dealId];
        if (loan.supplier == address(0)) revert NoLoan();
        if (loan.remaining == 0)         revert NoLoan();

        // Cap at remaining
        uint256 pay = amount > loan.remaining ? loan.remaining : amount;

        // Split: principal first, then interest.
        uint256 principalOwed = loan.principal - loan.principalPaid;
        uint256 principalPay  = pay <= principalOwed ? pay : principalOwed;
        uint256 interestPay   = pay - principalPay;

        loan.principalPaid += principalPay;
        loan.remaining     -= pay;

        // Both principal and interest increase freeLiquidity (USDC is back in the vault).
        // Interest is also credited to the per-lender accumulator so they can withdraw it.
        freeLiquidity += pay;
        _accrueInterest(interestPay);

        _usdc.safeTransferFrom(msg.sender, address(this), pay);
        emit Repaid(dealId, msg.sender, pay, loan.remaining);
    }
}
