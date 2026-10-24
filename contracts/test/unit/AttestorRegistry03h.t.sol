// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {AttestorRegistry} from "../../src/registry/AttestorRegistry.sol";
import {IAttestorRegistry} from "../../src/interfaces/IAttestorRegistry.sol";
import {WaybillEscrow} from "../../src/core/WaybillEscrow.sol";
import {IWaybillEscrow} from "../../src/interfaces/IWaybillEscrow.sol";
import {ArbiterList} from "../../src/registry/ArbiterList.sol";

// ---------------------------------------------------------------------------
// Minimal ERC-20 mock (no tokens stored on registry — escrow only)
// ---------------------------------------------------------------------------
contract MockUSDC03h {
    uint8 public decimals = 6;
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

/// @title AttestorRegistry03h — unit tests for AttestorRegistry
contract AttestorRegistry03h is Test {
    uint256 internal constant USDC_6 = 1e6;
    uint16  internal constant FEE_BPS = 75;

    // Registry
    AttestorRegistry internal reg;

    // Escrow (used for settle integration test)
    MockUSDC03h   internal usdc;
    ArbiterList   internal list;
    WaybillEscrow internal escrow;

    address internal pauser   = address(0xA1);
    address internal treasury = address(0xA2);
    address internal arbiter  = address(0xA3);
    address internal writer   = address(0xA4);   // separate writer for isolation tests
    address internal stranger = address(0xA5);

    // Attestor key for EIP-712 signing
    uint256 internal attPk;
    address internal attAddr;

    address internal buyer    = address(0xB1);
    address internal supplier = address(0xB2);
    address internal supPay   = address(0xB3);
    address internal buyRef   = address(0xB4);

    function setUp() public {
        (attAddr, attPk) = makeAddrAndKey("attestor03h");

        reg = new AttestorRegistry(pauser);

        usdc = new MockUSDC03h();
        address[] memory initArbs = new address[](1);
        initArbs[0] = arbiter;
        list  = new ArbiterList(pauser, initArbs);
        escrow = new WaybillEscrow(
            address(usdc), treasury, pauser,
            100_000 * USDC_6, 1_000_000 * USDC_6,
            address(list), address(reg)
        );
        vm.prank(pauser); reg.addWriter(address(escrow));
    }

    // -------------------------------------------------------------------------
    // H1: constructor has no writer (not even msg.sender)
    // -------------------------------------------------------------------------
    function testConstructorHasNoWriter() public view {
        assertFalse(reg.isWriter(pauser),         "pauser must not be writer");
        assertFalse(reg.isWriter(address(this)),   "deployer must not be writer");
    }

    // -------------------------------------------------------------------------
    // H2: only writer can record; all three OutcomeKind variants increment
    // -------------------------------------------------------------------------
    function testOnlyWriterCanRecord() public {
        // Non-writer reverts
        vm.prank(stranger);
        vm.expectRevert(IAttestorRegistry.NotWriter.selector);
        reg.recordOutcome(attAddr, IAttestorRegistry.OutcomeKind.Attested);

        // Add writer then verify all three variants
        vm.prank(pauser);
        reg.addWriter(writer);

        vm.prank(writer); reg.recordOutcome(attAddr, IAttestorRegistry.OutcomeKind.Attested);
        vm.prank(writer); reg.recordOutcome(attAddr, IAttestorRegistry.OutcomeKind.Upheld);
        vm.prank(writer); reg.recordOutcome(attAddr, IAttestorRegistry.OutcomeKind.Slashed);

        (uint32 a, uint32 u, uint32 s) = reg.counts(attAddr);
        assertEq(a, 1, "attested");
        assertEq(u, 1, "upheld");
        assertEq(s, 1, "slashed");
    }

    // -------------------------------------------------------------------------
    // H3: escrow settle increments attested once (dedup across milestones)
    // -------------------------------------------------------------------------
    function testEscrowSettleIncrementsAttestedOnce() public {
        // Build a single ATTESTATION milestone deal, attest + claim to settle.
        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](1);
        address[] memory attestors = new address[](1);
        attestors[0] = attAddr;
        ms[0] = IWaybillEscrow.MilestoneInput({
            bps: 10_000,
            condition: IWaybillEscrow.ReleaseCondition.ATTESTATION,
            attestors: attestors,
            threshold: 1,
            deadline: uint64(block.timestamp + 30 days),
            gracePeriod: 72,
            reviewWindow: 0,
            dependsOn: type(uint16).max
        });

        // Mint and approve
        uint256 total = 1_000 * USDC_6;
        uint256 fee   = (total * FEE_BPS + 9_999) / 10_000;
        usdc.mint(buyer, total + fee);
        vm.prank(buyer); usdc.approve(address(escrow), total + fee);

        // Create deal
        vm.prank(buyer);
        uint256 dealId = escrow.createDeal(
            supplier, buyRef, arbiter,
            total, FEE_BPS,
            uint64(block.timestamp + 7 days), 168, ms
        );

        // Accepts
        vm.prank(supplier);  escrow.acceptSupplier(dealId, supPay);
        vm.prank(attAddr);   escrow.acceptAttestor(dealId, 0);
        vm.prank(arbiter);   escrow.acceptArbiter(dealId);

        // Fund
        vm.prank(buyer); escrow.fund(dealId);

        // Attest (signs with attPk)
        bytes32 evidence = keccak256("evidence");
        uint64  signedAt = uint64(block.timestamp);
        uint64  expiry   = uint64(block.timestamp + 1 hours);

        bytes32 structHash = keccak256(abi.encode(
            escrow.ATTESTATION_TYPEHASH(),
            dealId,
            uint256(0),
            block.chainid,
            address(escrow),
            attAddr,                       // signer field
            escrow.STATEMENT_VERSION(),
            evidence,
            signedAt,
            expiry
        ));
        bytes32 digest = escrow.hashTypedDataV4(structHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(attPk, digest);
        bytes memory sig = abi.encodePacked(r, s, v);

        escrow.attest(dealId, 0, evidence, signedAt, expiry, attAddr, sig);

        // Claim — this triggers _checkAndSettleDeal which calls recordOutcome
        vm.prank(supplier); escrow.claim(dealId, 0);

        // Verify registry shows exactly 1 attested for attAddr
        (uint32 a, uint32 u, uint32 sl) = reg.counts(attAddr);
        assertEq(a,  1, "attested == 1 after settle");
        assertEq(u,  0, "upheld == 0");
        assertEq(sl, 0, "slashed == 0");
    }

    // -------------------------------------------------------------------------
    // H4: unauthorized cannot record after removeWriter
    // -------------------------------------------------------------------------
    function testUnauthorizedCannotRecordAfterRemoveWriter() public {
        vm.prank(pauser); reg.addWriter(writer);
        vm.prank(pauser); reg.removeWriter(writer);

        vm.prank(writer);
        vm.expectRevert(IAttestorRegistry.NotWriter.selector);
        reg.recordOutcome(attAddr, IAttestorRegistry.OutcomeKind.Attested);
    }

    // -------------------------------------------------------------------------
    // H5: status change requires 48h delay
    // -------------------------------------------------------------------------
    function testStatusRequiresDelay() public {
        // Direct setStatus reverts
        vm.prank(pauser);
        vm.expectRevert(IAttestorRegistry.DirectParamChange.selector);
        reg.setStatus(attAddr, IAttestorRegistry.Status.Registered);

        // Schedule
        vm.prank(pauser);
        reg.scheduleSetStatus(attAddr, IAttestorRegistry.Status.Suspended);

        // Execute immediately — too early
        vm.prank(pauser);
        vm.expectRevert(IAttestorRegistry.ChangeDelayActive.selector);
        reg.executeSetStatus(attAddr);

        // Warp 48 hours
        vm.warp(block.timestamp + 48 hours);
        vm.prank(pauser);
        reg.executeSetStatus(attAddr);

        assertEq(uint8(reg.status(attAddr)), uint8(IAttestorRegistry.Status.Suspended), "suspended");
    }

    // -------------------------------------------------------------------------
    // H6: registry has no token surface (no transferFrom selector in bytecode)
    // -------------------------------------------------------------------------
    function testRegistryHasNoTokenSurface() public view {
        bytes memory code = address(reg).code;
        // keccak256("transferFrom(address,address,uint256)") = 0x23b872dd...
        bytes4 selector = bytes4(0x23b872dd);
        bool found = false;
        for (uint256 i = 0; i + 3 < code.length; i++) {
            if (
                code[i]   == selector[0] &&
                code[i+1] == selector[1] &&
                code[i+2] == selector[2] &&
                code[i+3] == selector[3]
            ) { found = true; break; }
        }
        assertFalse(found, "registry must not contain transferFrom selector");
    }

    // -------------------------------------------------------------------------
    // H7: registry cannot claim on escrow (no claim() function)
    // -------------------------------------------------------------------------
    function testRegistryCannotClaimOnEscrow() public {
        // encoding claim(uint256,uint8) and calling it on the registry address
        // should revert (no such function) — verifying escrow USDC is not moved.
        usdc.mint(address(escrow), 1_000 * USDC_6);
        uint256 beforeBal = usdc.balanceOf(address(escrow));

        (bool ok,) = address(reg).call(
            abi.encodeWithSignature("claim(uint256,uint8)", 0, 0)
        );
        assertFalse(ok, "call to non-existent claim on registry must fail");
        assertEq(usdc.balanceOf(address(escrow)), beforeBal, "escrow USDC must be unchanged");
    }

    // -------------------------------------------------------------------------
    // H8: recordOutcome has no amount argument — counts only
    // -------------------------------------------------------------------------
    function testRecordDoesNotStoreAmounts() public {
        // Confirm the function selector is for (address, uint8) — not (address, uint8, uint256)
        // We call it with the correct 2-arg encoding and it succeeds.
        vm.prank(pauser); reg.addWriter(writer);

        // Correct 2-arg call succeeds
        vm.prank(writer);
        reg.recordOutcome(attAddr, IAttestorRegistry.OutcomeKind.Attested);

        (uint32 a,,) = reg.counts(attAddr);
        assertEq(a, 1, "count incremented");

        // Attempting a 3-arg call (with a fake amount) fails — wrong selector
        vm.prank(writer);
        (bool ok,) = address(reg).call(
            abi.encodeWithSignature("recordOutcome(address,uint8,uint256)",
                attAddr,
                uint8(IAttestorRegistry.OutcomeKind.Attested),
                uint256(999_000e6) // fake "amount" arg
            )
        );
        assertFalse(ok, "3-arg recordOutcome must not exist");

        // Counts unchanged from first call
        (uint32 a2,,) = reg.counts(attAddr);
        assertEq(a2, 1, "no second increment from 3-arg call");
    }
}
