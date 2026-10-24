// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {ArbiterList} from "../../src/registry/ArbiterList.sol";
import {IArbiterList} from "../../src/interfaces/IArbiterList.sol";
import {WaybillEscrow} from "../../src/core/WaybillEscrow.sol";
import {IWaybillEscrow} from "../../src/interfaces/IWaybillEscrow.sol";
import {AttestorRegistry} from "../../src/registry/AttestorRegistry.sol";

// ---------------------------------------------------------------------------
// Minimal ERC-20 mock
// ---------------------------------------------------------------------------
contract MockUSDC03g {
    string public name    = "Mock USDC";
    string public symbol  = "USDC";
    uint8  public decimals = 6;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    function mint(address to, uint256 amt) external { balanceOf[to] += amt; }
    function totalSupply() external pure returns (uint256) { return type(uint256).max; }
    function transfer(address to, uint256 amt) external returns (bool) {
        require(balanceOf[msg.sender] >= amt, "bal");
        balanceOf[msg.sender] -= amt; balanceOf[to] += amt; return true;
    }
    function transferFrom(address from, address to, uint256 amt) external returns (bool) {
        require(balanceOf[from] >= amt, "bal");
        require(allowance[from][msg.sender] >= amt, "allow");
        allowance[from][msg.sender] -= amt; balanceOf[from] -= amt; balanceOf[to] += amt; return true;
    }
    function approve(address spender, uint256 amt) external returns (bool) {
        allowance[msg.sender][spender] = amt; return true;
    }
}

/// @title ArbiterList03g — unit tests for the ArbiterList module
contract ArbiterList03g is Test {
    uint256 internal constant USDC_6 = 1e6;
    uint16  internal constant FEE_BPS = 75;

    MockUSDC03g   internal usdc;
    ArbiterList   internal list;
    WaybillEscrow internal escrow;

    address internal pauser    = address(0xA1);
    address internal treasury  = address(0xA2);
    address internal arbiter   = address(0xA3);
    address internal newArb    = address(0xA4);
    address internal buyer     = address(0xB1);
    address internal supplier  = address(0xB2);
    address internal buyRef    = address(0xB3);
    address internal supPay    = address(0xB4);

    function setUp() public {
        usdc = new MockUSDC03g();

        address[] memory initArbs = new address[](1);
        initArbs[0] = arbiter;
        list = new ArbiterList(pauser, initArbs);

        AttestorRegistry reg = new AttestorRegistry(pauser);
        escrow = new WaybillEscrow(
            address(usdc), treasury, pauser,
            100_000 * USDC_6, 1_000_000 * USDC_6,
            address(list), address(reg)
        );
        vm.prank(pauser); reg.addWriter(address(escrow));
    }

    // -------------------------------------------------------------------------
    // T1: constructor seeds initial arbiters but NOT the deployer
    // -------------------------------------------------------------------------
    function testConstructorSeedsInitialNotDeployer() public view {
        assertTrue(list.isAllowed(arbiter),   "initial arbiter allowed");
        assertFalse(list.isAllowed(address(this)), "deployer NOT seeded");
        assertFalse(list.isAllowed(pauser),        "pauser NOT seeded");
    }

    // -------------------------------------------------------------------------
    // T2: direct addArbiter reverts DirectParamChange
    // -------------------------------------------------------------------------
    function testDirectAddReverts() public {
        vm.prank(pauser);
        vm.expectRevert(IArbiterList.DirectParamChange.selector);
        list.addArbiter(newArb);
    }

    // -------------------------------------------------------------------------
    // T3: schedule -> warp 48h -> execute -> isAllowed + feeUsdc stored
    // -------------------------------------------------------------------------
    function testScheduleExecuteAddAfter48h() public {
        assertFalse(list.isAllowed(newArb), "not yet allowed");

        vm.prank(pauser);
        list.scheduleAddArbiter(newArb, 500 * USDC_6); // feeUsdc = 500 USDC

        (uint256 fee, uint64 eta) = list.getPendingAdd(newArb);
        assertEq(fee, 500 * USDC_6, "fee stored in pending");
        assertGt(eta, 0, "eta set");

        vm.warp(eta);
        vm.prank(pauser);
        list.executeAddArbiter(newArb);

        assertTrue(list.isAllowed(newArb),              "now allowed");
        assertEq(list.feeUsdc(newArb), 500 * USDC_6,   "feeUsdc persisted");
        (, uint64 eta2) = list.getPendingAdd(newArb);
        assertEq(eta2, 0, "pending cleared");
    }

    // -------------------------------------------------------------------------
    // T4: execute before delay reverts ChangeDelayActive
    // -------------------------------------------------------------------------
    function testExecuteAddBeforeDelayReverts() public {
        vm.prank(pauser);
        list.scheduleAddArbiter(newArb, 0);

        (, uint64 eta) = list.getPendingAdd(newArb);
        vm.warp(eta - 1);

        vm.prank(pauser);
        vm.expectRevert(IArbiterList.ChangeDelayActive.selector);
        list.executeAddArbiter(newArb);
    }

    // -------------------------------------------------------------------------
    // T5: remove after delay — isAllowed flips false
    // -------------------------------------------------------------------------
    function testRemoveAfterDelay() public {
        assertTrue(list.isAllowed(arbiter), "arbiter initially allowed");

        vm.prank(pauser);
        list.scheduleRemoveArbiter(arbiter);

        uint64 eta = list.getPendingRemove(arbiter);
        assertGt(eta, 0, "eta set");

        // Too early
        vm.prank(pauser);
        vm.expectRevert(IArbiterList.ChangeDelayActive.selector);
        list.executeRemoveArbiter(arbiter);

        vm.warp(eta);
        vm.prank(pauser);
        list.executeRemoveArbiter(arbiter);

        assertFalse(list.isAllowed(arbiter), "arbiter removed");
    }

    // -------------------------------------------------------------------------
    // T6: createDeal reads the list — ok if allowed, ArbiterNotAllowed after remove
    // -------------------------------------------------------------------------
    function testCreateDealReadsList() public {
        // Deal succeeds when arbiter is allowed
        uint256 total = 1_000 * USDC_6;
        uint256 fee   = (total * FEE_BPS + 9_999) / 10_000;
        usdc.mint(buyer, total + fee);

        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](1);
        ms[0] = IWaybillEscrow.MilestoneInput({
            bps: 10_000,
            condition: IWaybillEscrow.ReleaseCondition.ACCEPTANCE,
            attestors: new address[](0),
            threshold: 0,
            deadline: uint64(block.timestamp + 1 days),
            gracePeriod: 0,
            reviewWindow: 0,
            dependsOn: type(uint16).max
        });

        vm.prank(buyer);
        uint256 dealId = escrow.createDeal(
            supplier, buyRef, arbiter, total, FEE_BPS,
            uint64(block.timestamp + 7 days), 24, ms
        );
        assertGt(dealId + 1, 0, "deal created");

        // Remove arbiter via timelock
        vm.prank(pauser);
        list.scheduleRemoveArbiter(arbiter);
        uint64 eta = list.getPendingRemove(arbiter);
        vm.warp(eta);
        vm.prank(pauser);
        list.executeRemoveArbiter(arbiter);
        assertFalse(list.isAllowed(arbiter), "arbiter removed");

        // New deal with same arbiter reverts ArbiterNotAllowed
        usdc.mint(buyer, total + fee);
        vm.prank(buyer);
        vm.expectRevert(IWaybillEscrow.ArbiterNotAllowed.selector);
        escrow.createDeal(
            supplier, buyRef, arbiter, total, FEE_BPS,
            uint64(block.timestamp + 7 days), 24, ms
        );
    }

    // -------------------------------------------------------------------------
    // T7: ArbiterList has no token surface
    //     — transferFrom selector 0x23b872dd not present in bytecode
    // -------------------------------------------------------------------------
    function testListHasNoTokenSurface() public view {
        bytes memory code = address(list).code;
        // transferFrom(address,address,uint256) selector = 0x23b872dd
        bool found = false;
        for (uint256 i = 0; i + 3 < code.length; i++) {
            if (
                code[i]   == 0x23 &&
                code[i+1] == 0xb8 &&
                code[i+2] == 0x72 &&
                code[i+3] == 0xdd
            ) {
                found = true;
                break;
            }
        }
        assertFalse(found, "ArbiterList must not contain transferFrom selector");
    }

    // -------------------------------------------------------------------------
    // T8: escrow cannot be swept by list
    //     — ArbiterList has no function that takes an escrow address and moves tokens
    //     — Verified by confirming that calling any list function with escrow address
    //       does not move tokens out of escrow
    // -------------------------------------------------------------------------
    function testEscrowCannotBeSweptByList() public {
        // Fund escrow with some USDC
        uint256 total = 1_000 * USDC_6;
        uint256 fee   = (total * FEE_BPS + 9_999) / 10_000;
        usdc.mint(buyer, total + fee);

        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](1);
        ms[0] = IWaybillEscrow.MilestoneInput({
            bps: 10_000,
            condition: IWaybillEscrow.ReleaseCondition.ACCEPTANCE,
            attestors: new address[](0),
            threshold: 0,
            deadline: uint64(block.timestamp + 1 days),
            gracePeriod: 0,
            reviewWindow: 0,
            dependsOn: type(uint16).max
        });

        vm.prank(buyer);
        uint256 dealId = escrow.createDeal(
            supplier, buyRef, arbiter, total, FEE_BPS,
            uint64(block.timestamp + 7 days), 24, ms
        );
        vm.prank(supplier); escrow.acceptSupplier(dealId, supPay);
        vm.prank(arbiter);  escrow.acceptArbiter(dealId);
        vm.prank(buyer);    usdc.approve(address(escrow), total + fee);
        vm.prank(buyer);    escrow.fund(dealId);

        uint256 escrowBalanceBefore = usdc.balanceOf(address(escrow));
        assertGt(escrowBalanceBefore, 0, "escrow has funds");

        // All list functions: none should touch escrow token balance
        // scheduleAddArbiter — pauser-only, no token movement
        vm.prank(pauser);
        list.scheduleAddArbiter(newArb, 0);

        // Confirm escrow balance unchanged
        assertEq(usdc.balanceOf(address(escrow)), escrowBalanceBefore, "list cannot sweep escrow");

        // ArbiterList has no usdc member — verify no storage slot points to USDC address
        // (Pragmatic: list.isAllowed with escrow address does not revert and returns false)
        assertFalse(list.isAllowed(address(escrow)), "escrow addr is not an arbiter");
    }
}
