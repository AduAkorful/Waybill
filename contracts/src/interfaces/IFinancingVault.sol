// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IFinancingVault — unsecured reference loan pool in USDC.
/// @notice Lenders deposit idle cash; suppliers borrow against a FUNDED/SETTLED deal.
///         No tokens ever leave via escrow. No claim/refund/fund wrappers.
interface IFinancingVault {

    // -------------------------------------------------------------------------
    // Errors
    // -------------------------------------------------------------------------

    error NotSupplier();
    error InvalidDealState();
    error ZeroAmount();
    error ZeroAddress();
    error InsufficientLiquidity();
    error InterestCap();
    error LoanActive();
    error NoLoan();
    error TransferFailed();
    error NotContract();
    /// @notice Borrow amount exceeds the deal's totalAmount.
    error BorrowExceedsDeal();

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    event LenderDeposited(address indexed lender, uint256 amount);
    event LenderWithdrawn(address indexed lender, uint256 amount);
    event Borrowed(
        uint256 indexed dealId,
        address indexed supplier,
        uint256 amount,
        uint16 interestBps,
        uint256 remaining
    );
    event Repaid(
        uint256 indexed dealId,
        address indexed payer,
        uint256 amount,
        uint256 remaining
    );

    // -------------------------------------------------------------------------
    // Lender pool
    // -------------------------------------------------------------------------

    /// @notice Deposit USDC into the pool. Increases freeLiquidity.
    function deposit(uint256 amount) external;

    /// @notice Withdraw idle USDC up to lenderBalance[msg.sender] and freeLiquidity.
    function withdraw(uint256 amount) external;

    // -------------------------------------------------------------------------
    // Loan lifecycle
    // -------------------------------------------------------------------------

    /// @notice msg.sender must be deal.supplier; deal must be FUNDED or SETTLED.
    ///         Simple interest: remaining = amount + amount*interestBps/10000.
    ///         One active loan per dealId.
    function borrow(uint256 dealId, uint256 amount, uint16 interestBps) external;

    /// @notice Repay up to `remaining` for a loan. Anyone may repay.
    ///         Takes only min(amount, remaining) — overpay is silently capped.
    function repay(uint256 dealId, uint256 amount) external;

    // -------------------------------------------------------------------------
    // Views
    // -------------------------------------------------------------------------

    function usdc() external view returns (address);
    function escrow() external view returns (address);
    function pauser() external view returns (address);
    function freeLiquidity() external view returns (uint256);
    /// @notice Lender's total claimable: principal + pending pro-rata interest.
    function lenderBalance(address lender) external view returns (uint256);

    /// @notice Lender's deposited principal only (excludes pending interest).
    function lenderPrincipal(address lender) external view returns (uint256);

    /// @return supplier  borrower address
    /// @return principal original borrow amount (before interest)
    /// @return interestBps rate applied
    /// @return remaining  amount still owed (0 if fully repaid)
    function getLoan(uint256 dealId)
        external
        view
        returns (
            address supplier,
            uint256 principal,
            uint16 interestBps,
            uint256 remaining
        );
}
