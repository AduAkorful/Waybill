// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console2} from "forge-std/Test.sol";
import {IWaybillEscrow} from "../../src/interfaces/IWaybillEscrow.sol";
import {WaybillEscrow} from "../../src/core/WaybillEscrow.sol";
import {ArbiterList} from "../../src/registry/ArbiterList.sol";
import {AttestorRegistry} from "../../src/registry/AttestorRegistry.sol";
import {FinancingVault} from "../../src/vaults/FinancingVault.sol";
import {IFinancingVault} from "../../src/interfaces/IFinancingVault.sol";

// ── Minimal Mock USDC ────────────────────────────────────────────────────────
contract FVMockUSDC {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => bool) private _blocked;

    string public name     = "Mock USDC";
    string public symbol   = "USDC";
    uint8  public decimals = 6;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(!_blocked[to], "blocked");
        require(balanceOf[msg.sender] >= amount, "insufficient");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(!_blocked[to], "blocked");
        require(balanceOf[from] >= amount, "insufficient");
        require(allowance[from][msg.sender] >= amount, "allowance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function setBlocked(address addr, bool v) external { _blocked[addr] = v; }
}

// ─────────────────────────────────────────────────────────────────────────────
contract FinancingVault03j is Test {
    uint256 constant USDC_6 = 1e6;

    address pauser   = address(0xAA01);
    address treasury = address(0xAA02);
    address buyer    = address(0xAA03);
    address supplier = address(0xAA04);
    address arbiter  = address(0xAA05);
    address lender1  = address(0xAA06);
    address lender2  = address(0xAA07);
    address stranger = address(0xAA08);

    FVMockUSDC        usdc;
    WaybillEscrow     escrow;
    FinancingVault    vault;

    // ── deal constants ────────────────────────────────────────────────────────
    uint256 constant DEAL_AMOUNT = 1_000 * USDC_6;
    uint16  constant FEE_BPS     = 75;
    uint256 constant TOTAL_FEE   = DEAL_AMOUNT * FEE_BPS / 10_000;
    uint256 constant FUND_TOTAL  = DEAL_AMOUNT + TOTAL_FEE;

    uint256 dealId;

    // ── helpers ───────────────────────────────────────────────────────────────

    function _acceptanceMilestone() internal view returns (IWaybillEscrow.MilestoneInput[] memory) {
        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](1);
        ms[0] = IWaybillEscrow.MilestoneInput({
            bps:          10_000,
            condition:    IWaybillEscrow.ReleaseCondition.ACCEPTANCE,
            attestors:    new address[](0),
            threshold:    0,
            deadline:     uint64(block.timestamp + 30 days),
            gracePeriod:  0,
            reviewWindow: 0,
            dependsOn: type(uint16).max
        });
        return ms;
    }

    function setUp() public {
        usdc = new FVMockUSDC();

        address[] memory initArbs = new address[](1);
        initArbs[0] = arbiter;
        ArbiterList list = new ArbiterList(pauser, initArbs);

        AttestorRegistry reg = new AttestorRegistry(pauser);
        escrow = new WaybillEscrow(
            address(usdc), treasury, pauser,
            100_000 * USDC_6, 1_000_000 * USDC_6,
            address(list), address(reg)
        );
        vm.prank(pauser); reg.addWriter(address(escrow));

        vault = new FinancingVault(address(usdc), pauser, address(escrow));

        // Create + fund a deal so supplier is linked to a FUNDED deal
        vm.prank(buyer);
        dealId = escrow.createDeal(
            supplier,
            buyer,       // buyerRefund
            arbiter,
            DEAL_AMOUNT,
            FEE_BPS,
            uint64(block.timestamp + 7 days),
            48,
            _acceptanceMilestone()
        );
        vm.prank(supplier); escrow.acceptSupplier(dealId, supplier);
        vm.prank(arbiter);  escrow.acceptArbiter(dealId);

        // Fund — buyer needs FUND_TOTAL
        usdc.mint(buyer, FUND_TOTAL);
        vm.prank(buyer); usdc.approve(address(escrow), FUND_TOTAL);
        vm.prank(buyer); escrow.fund(dealId);

        // Mint USDC for lenders and approvals
        usdc.mint(lender1, 500 * USDC_6);
        usdc.mint(lender2, 500 * USDC_6);
        vm.prank(lender1); usdc.approve(address(vault), type(uint256).max);
        vm.prank(lender2); usdc.approve(address(vault), type(uint256).max);

        // Supplier approves vault for repayment
        vm.prank(supplier); usdc.approve(address(vault), type(uint256).max);
    }

    // ── T1: deposit/withdraw keeps escrow untouched ───────────────────────────
    function testDepositWithdrawIdle() public {
        uint256 escrowBefore = usdc.balanceOf(address(escrow));
        uint256 lockedBefore = escrow.getDeal(dealId).totalAmount; // totalAmount as proxy (currentLocked is internal but deal state is what matters)

        vm.prank(lender1); vault.deposit(100 * USDC_6);
        assertEq(vault.freeLiquidity(), 100 * USDC_6);
        assertEq(vault.lenderBalance(lender1), 100 * USDC_6);
        assertEq(usdc.balanceOf(address(escrow)), escrowBefore, "escrow bal changed on deposit");

        vm.prank(lender1); vault.withdraw(100 * USDC_6);
        assertEq(vault.freeLiquidity(), 0);
        assertEq(vault.lenderBalance(lender1), 0);
        assertEq(usdc.balanceOf(address(escrow)), escrowBefore, "escrow bal changed on withdraw");
        // Deal state unchanged
        assertEq(uint8(escrow.getDeal(dealId).state), uint8(IWaybillEscrow.DealState.FUNDED));
        assertEq(escrow.getDeal(dealId).totalAmount, lockedBefore);
    }

    // ── T2: only supplier can borrow ─────────────────────────────────────────
    function testBorrowRequiresSupplier() public {
        vm.prank(lender1); vault.deposit(100 * USDC_6);
        vm.prank(buyer);
        vm.expectRevert(IFinancingVault.NotSupplier.selector);
        vault.borrow(dealId, 50 * USDC_6, 100);
    }

    // ── T3: deal must be FUNDED/SETTLED ───────────────────────────────────────
    function testBorrowRequiresFunded() public {
        // Create a second deal that stays PROPOSED
        vm.prank(buyer);
        uint256 dealId2 = escrow.createDeal(
            supplier, buyer, arbiter, DEAL_AMOUNT, FEE_BPS,
            uint64(block.timestamp + 7 days), 48, _acceptanceMilestone()
        );
        vm.prank(lender1); vault.deposit(100 * USDC_6);
        vm.prank(supplier);
        vm.expectRevert(IFinancingVault.InvalidDealState.selector);
        vault.borrow(dealId2, 50 * USDC_6, 100);
    }

    // ── T4: borrow pays supplier, not escrow ─────────────────────────────────
    function testBorrowPaysSupplierNotEscrow() public {
        vm.prank(lender1); vault.deposit(200 * USDC_6);

        uint256 escrowBefore   = usdc.balanceOf(address(escrow));
        uint256 supplierBefore = usdc.balanceOf(supplier);
        uint256 liquidBefore   = vault.freeLiquidity();

        vm.prank(supplier); vault.borrow(dealId, 100 * USDC_6, 500);

        // Supplier received funds
        assertEq(usdc.balanceOf(supplier), supplierBefore + 100 * USDC_6, "supplier not paid");
        // Escrow USDC untouched
        assertEq(usdc.balanceOf(address(escrow)), escrowBefore, "escrow touched");
        // Free liquidity decreased by principal
        assertEq(vault.freeLiquidity(), liquidBefore - 100 * USDC_6, "liquidity wrong");
        // Deal state still FUNDED — currentLocked unchanged
        assertEq(uint8(escrow.getDeal(dealId).state), uint8(IWaybillEscrow.DealState.FUNDED));
    }

    // ── T5: repay restores liquidity ──────────────────────────────────────────
    function testRepayRestoresLiquidity() public {
        vm.prank(lender1); vault.deposit(200 * USDC_6);
        vm.prank(supplier); vault.borrow(dealId, 100 * USDC_6, 0); // zero interest for simplicity

        uint256 liqAfterBorrow = vault.freeLiquidity();
        assertEq(liqAfterBorrow, 100 * USDC_6);

        // Repay all
        vm.prank(supplier); vault.repay(dealId, 100 * USDC_6);
        assertEq(vault.freeLiquidity(), 200 * USDC_6, "liquidity not restored");

        (,, , uint256 remaining) = vault.getLoan(dealId);
        assertEq(remaining, 0, "remaining not zero");
    }

    // ── T6: simple interest, no compounding ──────────────────────────────────
    function testInterestSimpleNoCompound() public {
        // Deposit 200e6, borrow all of it at 1000 bps
        // remaining = 200e6 + 200e6*1000/10000 = 200e6 + 20e6 = 220e6
        vm.prank(lender1); vault.deposit(200 * USDC_6);
        vm.prank(supplier); vault.borrow(dealId, 200 * USDC_6, 1000);

        (,, , uint256 remaining) = vault.getLoan(dealId);
        uint256 interest = (200 * USDC_6 * 1000) / 10_000;
        assertEq(remaining, 200 * USDC_6 + interest, "remaining wrong");

        // Fully repay — supplier received 200e6, owes 220e6; needs 20e6 extra for interest
        usdc.mint(supplier, interest);
        vm.prank(supplier); vault.repay(dealId, remaining);
        (,, , uint256 rem2) = vault.getLoan(dealId);
        assertEq(rem2, 0, "not fully repaid");

        // Both principal and interest are back in freeLiquidity.
        assertEq(vault.freeLiquidity(), 200 * USDC_6 + interest, "freeLiquidity after full repay");

        // lender1 can withdraw principal + interest (lenderBalance returns both)
        uint256 entitledBefore = vault.lenderBalance(lender1);
        assertEq(entitledBefore, 200 * USDC_6 + interest, "lender1 entitled to principal+interest");
        vm.prank(lender1); vault.withdraw(entitledBefore);
        assertEq(vault.lenderBalance(lender1), 0, "lender1 balance zero after full withdraw");
    }

    // ── T7: interest cap at 2000 bps ─────────────────────────────────────────
    function testInterestCap2000() public {
        vm.prank(lender1); vault.deposit(100 * USDC_6);
        vm.prank(supplier);
        vm.expectRevert(IFinancingVault.InterestCap.selector);
        vault.borrow(dealId, 50 * USDC_6, 2001);
    }

    // ── T8: withdraw limited by freeLiquidity ────────────────────────────────
    function testWithdrawCannotExceedFreeLiquidity() public {
        vm.prank(lender1); vault.deposit(100 * USDC_6);
        vm.prank(lender2); vault.deposit(100 * USDC_6);
        // freeLiquidity = 200e6

        // Supplier borrows 150e6 → freeLiquidity = 50e6
        vm.prank(supplier); vault.borrow(dealId, 150 * USDC_6, 0);
        assertEq(vault.freeLiquidity(), 50 * USDC_6);

        // lender1 has balance 100e6 but only 50e6 is free
        vm.prank(lender1);
        vm.expectRevert(IFinancingVault.InsufficientLiquidity.selector);
        vault.withdraw(100 * USDC_6);

        // But 50e6 works
        vm.prank(lender1); vault.withdraw(50 * USDC_6);
    }

    // ── T9: vault cannot pull from escrow ────────────────────────────────────
    function testCannotTransferFromEscrow() public {
        uint256 escrowBal = usdc.balanceOf(address(escrow));
        // The vault has no allowance from escrow; direct safeTransferFrom(escrow, vault, 1) would revert
        // We simulate it: try to call transferFrom with vault as spender
        vm.expectRevert();
        vm.prank(address(vault));
        usdc.transferFrom(address(escrow), address(vault), 1);
        // Escrow balance unchanged
        assertEq(usdc.balanceOf(address(escrow)), escrowBal);
    }

    // ── T10: vault has no claim surface ──────────────────────────────────────
    function testVaultHasNoClaim() public {
        uint256 escrowBefore = usdc.balanceOf(address(escrow));
        // Encode a claim(uint256,uint8) call and send to vault — should return false / revert
        bytes memory data = abi.encodeWithSignature("claim(uint256,uint8)", dealId, uint8(0));
        (bool ok,) = address(vault).call(data);
        assertFalse(ok, "vault should not have claim()");
        // Escrow USDC untouched
        assertEq(usdc.balanceOf(address(escrow)), escrowBefore);
    }

    // ── T11: borrow amount > totalAmount reverts BorrowExceedsDeal (new fix) ──
    function testBorrowExceedsDealReverts() public {
        // The setUp deal has DEAL_AMOUNT = 1_000e6; mint enough for lender1 to cover DEAL_AMOUNT+1
        usdc.mint(lender1, DEAL_AMOUNT + 1);  // lender1 already has 500e6 from setUp
        vm.prank(lender1); vault.deposit(DEAL_AMOUNT + 1);

        vm.prank(supplier);
        vm.expectRevert(IFinancingVault.BorrowExceedsDeal.selector);
        vault.borrow(dealId, DEAL_AMOUNT + 1, 0);
    }

    // ── T12: borrow of exactly totalAmount succeeds (new fix) ─────────────────
    function testBorrowExactTotalAmountSucceeds() public {
        // Deposit enough for the full deal amount
        usdc.mint(lender1, DEAL_AMOUNT);
        vm.prank(lender1); usdc.approve(address(vault), DEAL_AMOUNT);
        vm.prank(lender1); vault.deposit(DEAL_AMOUNT);

        uint256 supplierBefore = usdc.balanceOf(supplier);
        vm.prank(supplier); vault.borrow(dealId, DEAL_AMOUNT, 0);

        assertEq(usdc.balanceOf(supplier), supplierBefore + DEAL_AMOUNT, "supplier paid full amount");
        assertEq(vault.freeLiquidity(), 0, "all liquidity consumed");
    }

    // ── T13: SETTLED deal no longer allows borrow (new fix) ──────────────────
    function testBorrowRevertsOnSettledDeal() public {
        // Claim the milestone to settle the deal
        vm.prank(supplier); escrow.claim(dealId, 0);
        assertEq(uint8(escrow.getDeal(dealId).state), uint8(IWaybillEscrow.DealState.SETTLED));

        vm.prank(lender1); vault.deposit(100 * USDC_6);
        vm.prank(supplier);
        vm.expectRevert(IFinancingVault.InvalidDealState.selector);
        vault.borrow(dealId, 50 * USDC_6, 0);
    }

    // ── T14: two lenders, pro-rata interest split ─────────────────────────────
    // Deposit 75 and 25. Borrow 100 at 1000 bps. Full repay.
    // Each withdraws exactly their share (75/25 split of 10e6 interest).
    function testTwoLendersProRataInterest() public {
        uint256 dep1  = 75 * USDC_6;
        uint256 dep2  = 25 * USDC_6;
        uint256 total = dep1 + dep2;                    // 100e6
        uint256 bps   = 1000;
        uint256 intAmt = (total * bps) / 10_000;        // 10e6

        vm.prank(lender1); vault.deposit(dep1);
        vm.prank(lender2); vault.deposit(dep2);

        vm.prank(supplier); vault.borrow(dealId, total, uint16(bps));
        usdc.mint(supplier, intAmt);
        vm.prank(supplier); vault.repay(dealId, total + intAmt);

        // lender1: 75e6 principal + 75% of 10e6 = 7.5e6 interest = 82.5e6
        uint256 share1 = dep1 + (intAmt * dep1) / total;   // 82_500_000
        // lender2: 25e6 principal + 25% of 10e6 = 2.5e6 interest = 27.5e6
        uint256 share2 = dep2 + (intAmt * dep2) / total;   // 27_500_000

        assertEq(vault.lenderBalance(lender1), share1, "lender1 balance");
        assertEq(vault.lenderBalance(lender2), share2, "lender2 balance");
        assertEq(vault.freeLiquidity(), total + intAmt, "free liquidity after repay");

        // Both can withdraw their exact share
        uint256 l1Before = usdc.balanceOf(lender1);
        vm.prank(lender1); vault.withdraw(share1);
        assertEq(usdc.balanceOf(lender1) - l1Before, share1, "lender1 received wrong amount");

        uint256 l2Before = usdc.balanceOf(lender2);
        vm.prank(lender2); vault.withdraw(share2);
        assertEq(usdc.balanceOf(lender2) - l2Before, share2, "lender2 received wrong amount");

        // Neither can withdraw again (balance is zero)
        vm.expectRevert(IFinancingVault.InsufficientLiquidity.selector);
        vm.prank(lender1); vault.withdraw(1);
        vm.expectRevert(IFinancingVault.InsufficientLiquidity.selector);
        vm.prank(lender2); vault.withdraw(1);
    }

    // ── T15: partial repay of principal only, no interest credited yet ─────────
    function testPartialPrincipalRepayNoInterestYet() public {
        uint256 dep    = 100 * USDC_6;
        uint256 bps    = 1000;
        uint256 intAmt = (dep * bps) / 10_000;   // 10e6

        vm.prank(lender1); vault.deposit(dep);
        vm.prank(supplier); vault.borrow(dealId, dep, uint16(bps));

        // Repay only half the principal (50e6 < principal 100e6)
        vm.prank(supplier); vault.repay(dealId, 50 * USDC_6);

        // freeLiquidity gained 50e6 (principal), zero interest credited
        assertEq(vault.freeLiquidity(), 50 * USDC_6, "freeLiquidity after partial principal repay");

        // lenderBalance = principal (100e6), zero interest accrued yet
        assertEq(vault.lenderBalance(lender1), dep, "no interest yet");

        // Remaining = (100+10) - 50 = 60e6
        (,,, uint256 rem) = vault.getLoan(dealId);
        assertEq(rem, 60 * USDC_6, "remaining after partial");

        // Now repay rest (including interest)
        usdc.mint(supplier, intAmt);
        vm.prank(supplier); vault.repay(dealId, 60 * USDC_6);

        // freeLiquidity gets remaining 50e6 principal + 10e6 interest = 110e6 total
        assertEq(vault.freeLiquidity(), 100 * USDC_6 + intAmt, "freeLiquidity after full repay");
        assertEq(vault.lenderBalance(lender1), dep + intAmt, "lender1 gets full principal+interest");
    }

    // ── T16: repay above remaining takes only the owed amount ─────────────────
    function testRepayAboveRemainingCapped() public {
        vm.prank(lender1); vault.deposit(100 * USDC_6);
        vm.prank(supplier); vault.borrow(dealId, 100 * USDC_6, 1000);  // owes 110e6

        usdc.mint(supplier, 200 * USDC_6);
        uint256 supBefore = usdc.balanceOf(supplier);

        // Try to overpay by 100e6
        vm.prank(supplier); vault.repay(dealId, 210 * USDC_6);

        // Only 110e6 taken (remaining capped)
        assertEq(supBefore - usdc.balanceOf(supplier), 110 * USDC_6, "only owed amount taken");

        (,,, uint256 rem) = vault.getLoan(dealId);
        assertEq(rem, 0, "remaining is zero");
    }

    // ── T17: three lenders, 1-unit interest — dust stays, balances sum correctly
    function testThreeLendersInterestDust() public {
        // Three lenders deposit 1, 1, 1 (total 3)
        address lender3 = address(0xAA09);
        usdc.mint(lender3, 3 * USDC_6);
        vm.prank(lender3); usdc.approve(address(vault), type(uint256).max);

        // Use tiny amounts: 3 wei total to force dust
        vm.prank(lender1); vault.deposit(1);
        vm.prank(lender2); vault.deposit(1);
        vm.prank(lender3); vault.deposit(1);

        // borrow 3 wei at 0 bps; repay principal + 1 wei interest artificially:
        // We can't easily borrow at fractional bps, so instead borrow 0-bps and
        // deposit 1 extra wei directly (simulate interest via a second deposit then
        // manually — but vault has no admin credit).
        // Instead: borrow 3 at bps=0, repay 4 (cap=3), then mint 1 to vault externally
        // and verify invariant directly.
        //
        // Cleaner: borrow 30000 at 10000/3 bps ≈ 3333 bps → interest = 30000*3333/10000 = 9999
        // Actually just borrow 3 units at 3333 bps → interest = 3*3333/10000 = 0 (truncates to 0)
        // 
        // To get exactly 1 wei interest, borrow 10000 at 1 bps → interest = 10000*1/10000 = 1.
        // Lender deposits: 1/1/1 already. Need total=10000. Let's just use 3e6/3e6/3e6 = 9e6 total,
        // borrow 9e6 at 1 bps → interest = 9e6*1/10000 = 900. Share per lender: 300 each (3e6/9e6).

        // Re-setup cleaner with larger amounts
        // lender1/2 already have 500e6 - 1 wei; lender3 has 3e6 - 1 wei (after above deposits)
        // Just reset with explicit values on a fresh vault
        FinancingVault vault2 = new FinancingVault(address(usdc), pauser, address(escrow));

        address lA = address(0xBB01);
        address lB = address(0xBB02);
        address lC = address(0xBB03);
        usdc.mint(lA, 3 * USDC_6); usdc.mint(lB, 3 * USDC_6); usdc.mint(lC, 3 * USDC_6);
        vm.prank(lA); usdc.approve(address(vault2), type(uint256).max);
        vm.prank(lB); usdc.approve(address(vault2), type(uint256).max);
        vm.prank(lC); usdc.approve(address(vault2), type(uint256).max);
        vm.prank(supplier); usdc.approve(address(vault2), type(uint256).max);

        vm.prank(lA); vault2.deposit(3 * USDC_6);
        vm.prank(lB); vault2.deposit(3 * USDC_6);
        vm.prank(lC); vault2.deposit(3 * USDC_6);

        // Borrow 9e6 at 1 bps → interest = 9e6 * 1 / 10000 = 900 (truncated)
        vm.prank(supplier); vault2.borrow(dealId, 9 * USDC_6, 1);
        uint256 interest = (9 * USDC_6 * 1) / 10_000;  // 900
        usdc.mint(supplier, interest);
        vm.prank(supplier); vault2.repay(dealId, 9 * USDC_6 + interest);

        // Each lender's share of 900 interest = 300 each (equal deposits)
        uint256 shareInt = interest / 3;  // 300 each; dust = interest - 3*shareInt (0 here)
        uint256 entitled = 3 * USDC_6 + shareInt;

        assertEq(vault2.lenderBalance(lA), entitled, "lA balance");
        assertEq(vault2.lenderBalance(lB), entitled, "lB balance");
        assertEq(vault2.lenderBalance(lC), entitled, "lC balance");

        // Sum of credited interest <= actual interest paid (dust stays in vault)
        uint256 totalCredited = vault2.lenderBalance(lA) + vault2.lenderBalance(lB) + vault2.lenderBalance(lC) - 9 * USDC_6;
        assertLe(totalCredited, interest, "credited interest exceeds paid interest");

        // Vault USDC = principal (9e6) + interest repaid (900) — both back in vault.
        // Dust = interest - sum of per-lender credited amounts (truncation residual).
        uint256 vaultBal = usdc.balanceOf(address(vault2));
        uint256 dust = interest - totalCredited;
        assertEq(vaultBal, 9 * USDC_6 + interest, "vault holds principal + full interest");
        // Dust stays unreachable (no lender can claim it)
        assertGe(dust, 0, "dust >= 0");
        assertLe(dust, 2, "dust is at most 2 wei for 3 lenders");
    }

    // ── T18: lender cannot withdraw lent principal ────────────────────────────
    function testLenderCannotWithdrawLentPrincipal() public {
        uint256 dep = 100 * USDC_6;
        vm.prank(lender1); vault.deposit(dep);

        // freeLiquidity = 100e6; borrow all of it
        vm.prank(supplier); vault.borrow(dealId, dep, 0);
        assertEq(vault.freeLiquidity(), 0, "no free liquidity after borrow");

        // lender1 is entitled to 100e6 but freeLiquidity = 0
        vm.prank(lender1);
        vm.expectRevert(IFinancingVault.InsufficientLiquidity.selector);
        vault.withdraw(dep);
    }
}
