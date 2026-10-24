// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {BondVault}          from "../../src/vaults/BondVault.sol";
import {IBondVault}         from "../../src/interfaces/IBondVault.sol";
import {WaybillEscrow}      from "../../src/core/WaybillEscrow.sol";
import {IWaybillEscrow}     from "../../src/interfaces/IWaybillEscrow.sol";
import {ArbiterList}        from "../../src/registry/ArbiterList.sol";
import {AttestorRegistry}   from "../../src/registry/AttestorRegistry.sol";
import {IAttestorRegistry}  from "../../src/interfaces/IAttestorRegistry.sol";

// ---------------------------------------------------------------------------
// Minimal ERC-20 mock
// ---------------------------------------------------------------------------
contract MockUSDC03i {
    uint8 public decimals = 6;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amt) external { balanceOf[to] += amt; }

    function transfer(address to, uint256 amt) external returns (bool) {
        require(balanceOf[msg.sender] >= amt, "bal");
        balanceOf[msg.sender] -= amt; balanceOf[to] += amt; return true;
    }

    function transferFrom(address from, address to, uint256 amt) external returns (bool) {
        require(balanceOf[from] >= amt, "bal");
        require(allowance[from][msg.sender] >= amt, "allow");
        allowance[from][msg.sender] -= amt;
        balanceOf[from] -= amt; balanceOf[to] += amt; return true;
    }

    function approve(address spender, uint256 amt) external returns (bool) {
        allowance[msg.sender][spender] = amt; return true;
    }
}

// ---------------------------------------------------------------------------
// BondVault03i test suite
// ---------------------------------------------------------------------------
contract BondVault03i is Test {
    uint256 internal constant USDC_6  = 1e6;
    uint16  internal constant FEE_BPS = 75;

    MockUSDC03i   internal usdc;
    ArbiterList   internal list;
    AttestorRegistry internal reg;
    WaybillEscrow internal escrow;
    BondVault     internal vault;

    address internal pauser   = address(0xA1);
    address internal treasury = address(0xA2);
    address internal arbiter  = address(0xA3);
    address internal buyer    = address(0xB1);
    address internal supplier = address(0xB2);
    address internal supPay   = address(0xB3);
    address internal buyRef   = address(0xB4);

    uint256 internal attPk;
    address internal attAddr;

    // Deal state cached after _setupDisputedDeal
    uint256 internal dealId;

    // Bond amounts
    uint256 internal constant BOND_AMOUNT = 1_000 * USDC_6;

    function setUp() public {
        (attAddr, attPk) = makeAddrAndKey("att03i");

        usdc = new MockUSDC03i();

        address[] memory initArbs = new address[](1);
        initArbs[0] = arbiter;
        list = new ArbiterList(pauser, initArbs);

        reg = new AttestorRegistry(pauser);

        escrow = new WaybillEscrow(
            address(usdc), treasury, pauser,
            100_000 * USDC_6, 1_000_000 * USDC_6,
            address(list), address(reg)
        );
        vm.prank(pauser); reg.addWriter(address(escrow));

        vault = new BondVault(address(usdc), pauser, address(escrow), address(reg));
        vm.prank(pauser); reg.addWriter(address(vault));
    }

    // =========================================================================
    // Helpers
    // =========================================================================

    /// Build a single ATTESTATION milestone with reviewWindow > 0.
    function _attestationMs() internal view returns (IWaybillEscrow.MilestoneInput[] memory) {
        address[] memory attestors = new address[](1);
        attestors[0] = attAddr;
        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](1);
        ms[0] = IWaybillEscrow.MilestoneInput({
            bps:          10_000,
            condition:    IWaybillEscrow.ReleaseCondition.ATTESTATION,
            attestors:    attestors,
            threshold:    1,
            deadline:     uint64(block.timestamp + 30 days),
            gracePeriod:  72,
            reviewWindow: 24,     // review window > 0 so buyer can dispute
            dependsOn: type(uint16).max
        });
        return ms;
    }

    /// Create, accept, fund a deal; attest → IN_REVIEW; buyer disputes → DISPUTED.
    function _setupDisputedDeal() internal {
        uint256 total = 1_000 * USDC_6;
        uint256 fee   = (total * FEE_BPS + 9_999) / 10_000;
        usdc.mint(buyer, total + fee);
        vm.prank(buyer); usdc.approve(address(escrow), total + fee);

        vm.prank(buyer);
        dealId = escrow.createDeal(
            supplier, buyRef, arbiter,
            total, FEE_BPS,
            uint64(block.timestamp + 7 days), 168,
            _attestationMs()
        );

        vm.prank(supplier);  escrow.acceptSupplier(dealId, supPay);
        vm.prank(attAddr);   escrow.acceptAttestor(dealId, 0);
        vm.prank(arbiter);   escrow.acceptArbiter(dealId);
        vm.prank(buyer);     escrow.fund(dealId);

        // Attest → IN_REVIEW
        bytes32 evidence = keccak256("ev");
        uint64  signedAt = uint64(block.timestamp);
        uint64  expiry   = uint64(block.timestamp + 1 hours);
        bytes32 structHash = keccak256(abi.encode(
            escrow.ATTESTATION_TYPEHASH(), dealId, uint256(0),
            block.chainid, address(escrow), attAddr,  // signer field
            escrow.STATEMENT_VERSION(),
            evidence, signedAt, expiry
        ));
        bytes32 digest = escrow.hashTypedDataV4(structHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(attPk, digest);
        escrow.attest(dealId, 0, evidence, signedAt, expiry, attAddr, abi.encodePacked(r, s, v));

        // Buyer disputes while IN_REVIEW
        vm.prank(buyer);
        escrow.dispute(dealId, 0, keccak256("buyer-evidence"));
    }

    /// Deposit bond from attestor.
    function _depositBond(uint256 amt) internal {
        usdc.mint(attAddr, amt);
        vm.prank(attAddr); usdc.approve(address(vault), amt);
        vm.prank(attAddr); vault.deposit(amt);
    }

    // =========================================================================
    // I1: deposit and withdraw do not touch escrow
    // =========================================================================
    function testDepositWithdrawDoesNotTouchEscrow() public {
        uint256 escrowBefore = usdc.balanceOf(address(escrow));
        _depositBond(BOND_AMOUNT);

        assertEq(vault.freeBond(attAddr), BOND_AMOUNT, "freeBond after deposit");
        assertEq(usdc.balanceOf(address(vault)), BOND_AMOUNT, "vault balance");
        assertEq(usdc.balanceOf(address(escrow)), escrowBefore, "escrow unchanged after deposit");

        vm.prank(attAddr); vault.withdraw(BOND_AMOUNT);
        assertEq(vault.freeBond(attAddr), 0, "freeBond after withdraw");
        assertEq(usdc.balanceOf(address(vault)), 0, "vault empty");
        assertEq(usdc.balanceOf(address(escrow)), escrowBefore, "escrow unchanged after withdraw");
    }

    // =========================================================================
    // I2: non-arbiter cannot flag
    // =========================================================================
    function testFlagNonArbiterReverts() public {
        _setupDisputedDeal();
        _depositBond(BOND_AMOUNT);

        vm.prank(buyer);
        vm.expectRevert(IBondVault.NotArbiter.selector);
        vault.flagNegligent(dealId, 0, attAddr, 5_000, buyRef);
    }

    // =========================================================================
    // I3: harmed = protocolTreasury reverts HarmedForbidden
    // =========================================================================
    function testFlagToTreasuryReverts() public {
        _setupDisputedDeal();
        _depositBond(BOND_AMOUNT);

        // deal.protocolTreasury == treasury (snapshotted at createDeal)
        vm.prank(arbiter);
        vm.expectRevert(IBondVault.HarmedForbidden.selector);
        vault.flagNegligent(dealId, 0, attAddr, 5_000, treasury);
    }

    // =========================================================================
    // I4: harmed = pauser reverts HarmedForbidden
    // =========================================================================
    function testFlagToPauserReverts() public {
        _setupDisputedDeal();
        _depositBond(BOND_AMOUNT);

        vm.prank(arbiter);
        vm.expectRevert(IBondVault.HarmedForbidden.selector);
        vault.flagNegligent(dealId, 0, attAddr, 5_000, pauser);
    }

    // =========================================================================
    // I5: flag locks bond but does not transfer to harmed yet
    // =========================================================================
    function testFlagLocksBondDoesNotPayYet() public {
        _setupDisputedDeal();
        _depositBond(BOND_AMOUNT);

        uint256 harmedBefore = usdc.balanceOf(buyRef);

        vm.prank(arbiter);
        vault.flagNegligent(dealId, 0, attAddr, 5_000, buyRef);

        assertEq(vault.freeBond(attAddr), BOND_AMOUNT / 2, "half locked (50% bps)");
        assertEq(usdc.balanceOf(buyRef), harmedBefore, "harmed not paid yet");
    }

    // =========================================================================
    // I6: execute before 72h reverts AppealActive
    // =========================================================================
    function testExecuteBeforeAppealReverts() public {
        _setupDisputedDeal();
        _depositBond(BOND_AMOUNT);

        vm.prank(arbiter);
        uint256 slashId = vault.flagNegligent(dealId, 0, attAddr, 5_000, buyRef);

        vm.warp(block.timestamp + 71 hours);
        vm.expectRevert(IBondVault.AppealActive.selector);
        vault.executeSlash(slashId);
    }

    // =========================================================================
    // I7: execute after 72h pays harmed, not treasury/pauser; registry updated
    // =========================================================================
    function testExecuteAfter72hPaysHarmedNotTreasury() public {
        _setupDisputedDeal();
        _depositBond(BOND_AMOUNT);

        uint256 slashAmt = BOND_AMOUNT * 5_000 / 10_000;
        uint256 harmedBefore   = usdc.balanceOf(buyRef);
        uint256 treasuryBefore = usdc.balanceOf(treasury);
        uint256 pauserBefore   = usdc.balanceOf(pauser);
        uint256 escrowLocked   = escrow.currentLocked();

        vm.prank(arbiter);
        uint256 slashId = vault.flagNegligent(dealId, 0, attAddr, 5_000, buyRef);

        vm.warp(block.timestamp + 72 hours);
        vault.executeSlash(slashId);

        assertEq(usdc.balanceOf(buyRef),  harmedBefore + slashAmt, "harmed receives slash");
        assertEq(usdc.balanceOf(treasury), treasuryBefore,         "treasury unchanged");
        assertEq(usdc.balanceOf(pauser),   pauserBefore,           "pauser unchanged");
        assertEq(escrow.currentLocked(),   escrowLocked,           "escrow.currentLocked unchanged");

        (, uint32 upheld, uint32 slashed) = reg.counts(attAddr);
        assertEq(slashed, 1, "registry: slashed == 1");
        assertEq(upheld,  1, "registry: upheld == 1");
    }

    // =========================================================================
    // I8: reverse restores bond; subsequent execute reverts
    // =========================================================================
    function testReverseRestoresBond() public {
        _setupDisputedDeal();
        _depositBond(BOND_AMOUNT);

        vm.prank(arbiter);
        uint256 slashId = vault.flagNegligent(dealId, 0, attAddr, 10_000, buyRef);

        // Reverse before eta
        vm.prank(arbiter);
        vault.reverseFlag(slashId);

        assertEq(vault.freeBond(attAddr), BOND_AMOUNT, "freeBond fully restored");

        // Execute after eta now reverts (reversed)
        vm.warp(block.timestamp + 73 hours);
        vm.expectRevert(IBondVault.AlreadyReversed.selector);
        vault.executeSlash(slashId);
    }

    // =========================================================================
    // I9: vault cannot pull escrow USDC via transferFrom
    // =========================================================================
    function testVaultCannotPullEscrow() public {
        _setupDisputedDeal();
        _depositBond(BOND_AMOUNT);

        uint256 escrowBal = usdc.balanceOf(address(escrow));

        // Vault has zero allowance from escrow; this should fail
        vm.prank(address(vault));
        (bool ok,) = address(usdc).call(
            abi.encodeWithSignature(
                "transferFrom(address,address,uint256)",
                address(escrow), address(vault), escrowBal
            )
        );
        assertFalse(ok, "transferFrom escrow->vault must fail (no allowance)");
        assertEq(usdc.balanceOf(address(escrow)), escrowBal, "escrow USDC unchanged");
    }

    // =========================================================================
    // I10: calling claim on vault address does not move deal funds
    // =========================================================================
    function testVaultClaimDoesNotMoveDealFunds() public {
        _setupDisputedDeal();
        _depositBond(BOND_AMOUNT);

        uint256 escrowBal = usdc.balanceOf(address(escrow));

        // Encode claim(uint256,uint8) and send to vault address (which has no such function)
        (bool ok,) = address(vault).call(
            abi.encodeWithSignature("claim(uint256,uint8)", dealId, uint8(0))
        );
        assertFalse(ok, "claim on vault address must fail");
        assertEq(usdc.balanceOf(address(escrow)), escrowBal, "escrow USDC unchanged");
    }
}
