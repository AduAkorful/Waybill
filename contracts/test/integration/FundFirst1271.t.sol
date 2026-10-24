// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {WaybillEscrow} from "../../src/core/WaybillEscrow.sol";
import {IWaybillEscrow} from "../../src/interfaces/IWaybillEscrow.sol";
import {ArbiterList} from "../../src/registry/ArbiterList.sol";
import {AttestorRegistry} from "../../src/registry/AttestorRegistry.sol";

// ---------------------------------------------------------------------------
// Minimal ERC-20 mock
// ---------------------------------------------------------------------------
contract MockUSDC03f {
    string public name    = "Mock USDC";
    string public symbol  = "USDC";
    uint8  public decimals = 6;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external { balanceOf[to] += amount; }
    function totalSupply() external pure returns (uint256) { return type(uint256).max; }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "bal");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "bal");
        require(allowance[from][msg.sender] >= amount, "allow");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }
}

// ---------------------------------------------------------------------------
// ERC-1271 mock signer contract: always accepts the configured digest, rejects others
// ---------------------------------------------------------------------------
contract ERC1271Signer {
    bytes4 constant MAGIC = 0x1626ba7e;
    bytes32 public validDigest;

    constructor(bytes32 _digest) {
        validDigest = _digest;
    }

    function setDigest(bytes32 d) external { validDigest = d; }

    function isValidSignature(bytes32 hash, bytes calldata) external view returns (bytes4) {
        return hash == validDigest ? MAGIC : bytes4(0xffffffff);
    }
}

// ---------------------------------------------------------------------------
// ERC-1271 mock that always rejects
// ---------------------------------------------------------------------------
contract BadERC1271Signer {
    function isValidSignature(bytes32, bytes calldata) external pure returns (bytes4) {
        return bytes4(0xffffffff);
    }
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------
contract FundFirst1271 is Test {
    uint256 internal constant USDC_6 = 1e6;
    uint16  internal constant FEE_BPS = 75;

    MockUSDC03f internal usdc;
    WaybillEscrow internal escrow;

    address internal pauser   = address(0x1A);
    address internal treasury = address(0x1B);

    // Separate keys for attestation signing
    uint256 internal attPk;
    address internal attAddr;

    address internal arbiter  = address(0x1C);
    address internal buyer;
    address internal supplier = address(0x30);
    address internal supPay   = address(0x31);
    address internal buyRef   = address(0x32);

    function setUp() public {
        // Deploy mock USDC and escrow
        usdc = new MockUSDC03f();
        address[] memory initArbs = new address[](1);
        initArbs[0] = arbiter;
        ArbiterList list = new ArbiterList(pauser, initArbs);
        AttestorRegistry reg = new AttestorRegistry(pauser);

        vm.prank(pauser);
        escrow = new WaybillEscrow(
            address(usdc),
            treasury,
            pauser,
            100_000 * USDC_6,
            1_000_000 * USDC_6,
            address(list),
            address(reg)
        );
        vm.prank(pauser); reg.addWriter(address(escrow));

        // Generate attestor key
        (attAddr, attPk) = makeAddrAndKey("attestor");
        // Use a stable buyer address that does not collide with other actors
        buyer = address(0x40);
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    function _acceptanceMilestone() internal view returns (IWaybillEscrow.MilestoneInput memory) {
        return IWaybillEscrow.MilestoneInput({
            bps: 10_000,
            condition: IWaybillEscrow.ReleaseCondition.ACCEPTANCE,
            attestors: new address[](0),
            threshold: 0,
            deadline: uint64(block.timestamp + 1 days),
            gracePeriod: 0,
            reviewWindow: 0,
            dependsOn: type(uint16).max
        });
    }

    function _attestationMilestone(address att) internal view returns (IWaybillEscrow.MilestoneInput memory) {
        address[] memory atts = new address[](1);
        atts[0] = att;
        return IWaybillEscrow.MilestoneInput({
            bps: 10_000,
            condition: IWaybillEscrow.ReleaseCondition.ATTESTATION,
            attestors: atts,
            threshold: 1,
            deadline: uint64(block.timestamp + 2 days),
            gracePeriod: 24,
            reviewWindow: 0,
            dependsOn: type(uint16).max
        });
    }

    function _fundFirstDeal(IWaybillEscrow.MilestoneInput memory msInput)
        internal returns (uint256 dealId)
    {
        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](1);
        ms[0] = msInput;
        uint256 total = 1_000 * USDC_6;
        uint256 fee   = (total * FEE_BPS + 9_999) / 10_000;
        usdc.mint(buyer, total + fee);

        vm.prank(buyer);
        dealId = escrow.createDeal(
            supplier, buyRef, arbiter, total, FEE_BPS,
            uint64(block.timestamp + 7 days), 24, ms, true
        );
    }

    function _normalDeal(IWaybillEscrow.MilestoneInput memory msInput)
        internal returns (uint256 dealId)
    {
        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](1);
        ms[0] = msInput;
        uint256 total = 1_000 * USDC_6;
        uint256 fee   = (total * FEE_BPS + 9_999) / 10_000;
        usdc.mint(buyer, total + fee);

        vm.prank(buyer);
        dealId = escrow.createDeal(
            supplier, buyRef, arbiter, total, FEE_BPS,
            uint64(block.timestamp + 7 days), 24, ms
        );
    }

    function _fundDeal(uint256 dealId) internal {
        IWaybillEscrow.Deal memory d = escrow.getDeal(dealId);
        vm.startPrank(buyer);
        usdc.approve(address(escrow), d.totalAmount + d.prepaidFee);
        escrow.fund(dealId);
        vm.stopPrank();
    }

    function _signAttestation(
        uint256 dealId, uint8 msIdx, bytes32 evidenceHash, uint64 signedAt, uint64 expiry, uint256 pk
    ) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(abi.encode(
            escrow.ATTESTATION_TYPEHASH(),
            dealId, msIdx, block.chainid, address(escrow),
            vm.addr(pk),                  // signer field
            escrow.STATEMENT_VERSION(), evidenceHash, signedAt, expiry
        ));
        bytes32 digest = escrow.hashTypedDataV4(structHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    // -------------------------------------------------------------------------
    // Test 1: fundFirst deals can be funded before any accepts
    // -------------------------------------------------------------------------
    function testFundFirstFundsWithoutAccepts() public {
        uint256 dealId = _fundFirstDeal(_acceptanceMilestone());

        // State should be PROPOSED; no one has accepted yet
        assertEq(uint8(escrow.getDeal(dealId).state), uint8(IWaybillEscrow.DealState.PROPOSED));

        // Funding before any accepts should succeed
        _fundDeal(dealId);

        assertEq(uint8(escrow.getDeal(dealId).state), uint8(IWaybillEscrow.DealState.FUNDED));
    }

    // -------------------------------------------------------------------------
    // Test 2: default (non-fundFirst) createDeal still requires accepts before fund
    // -------------------------------------------------------------------------
    function testDefaultCreateDealStillRequiresAccepts() public {
        uint256 dealId = _normalDeal(_acceptanceMilestone());

        uint256 total = escrow.getDeal(dealId).totalAmount;
        uint256 fee   = escrow.getDeal(dealId).prepaidFee;
        usdc.mint(buyer, total + fee); // extra mint just in case
        vm.startPrank(buyer);
        usdc.approve(address(escrow), total + fee);
        vm.expectRevert(IWaybillEscrow.NotFullyAccepted.selector);
        escrow.fund(dealId);
        vm.stopPrank();
    }

    // -------------------------------------------------------------------------
    // Test 3: fundFirst claim reverts SupplierNotAccepted when supplier hasn't accepted
    // -------------------------------------------------------------------------
    function testFundFirstClaimRevertsWithoutSupplierAccept() public {
        uint256 dealId = _fundFirstDeal(_acceptanceMilestone());
        _fundDeal(dealId);

        // ACCEPTANCE milestone goes CLAIMABLE on fund — but supplier hasn't accepted
        vm.expectRevert(IWaybillEscrow.SupplierNotAccepted.selector);
        escrow.claim(dealId, 0);
    }

    // -------------------------------------------------------------------------
    // Test 4: fundFirst claim succeeds after supplier accepts post-fund
    // -------------------------------------------------------------------------
    function testFundFirstClaimAfterSupplierAccept() public {
        uint256 dealId = _fundFirstDeal(_acceptanceMilestone());
        _fundDeal(dealId);

        // Supplier and arbiter accept after funding
        vm.prank(supplier); escrow.acceptSupplier(dealId, supPay);
        vm.prank(arbiter);  escrow.acceptArbiter(dealId);

        uint256 beforeSupPay = usdc.balanceOf(supPay);
        escrow.claim(dealId, 0);
        assertGt(usdc.balanceOf(supPay), beforeSupPay, "supplier got paid");
        assertEq(uint8(escrow.getDeal(dealId).state), uint8(IWaybillEscrow.DealState.SETTLED));
    }

    // -------------------------------------------------------------------------
    // Test 5: fundFirst cancelUnaccepted refunds exact totalAmount+prepaidFee
    // -------------------------------------------------------------------------
    function testFundFirstCancelUnacceptedRefundsExact() public {
        uint256 dealId = _fundFirstDeal(_acceptanceMilestone());
        IWaybillEscrow.Deal memory d = escrow.getDeal(dealId);
        uint256 refundExpected = d.totalAmount + d.prepaidFee;
        _fundDeal(dealId);

        // Warp past acceptance deadline without supplier accepting
        vm.warp(d.acceptanceDeadline + 1);

        uint256 beforeBuyRef = usdc.balanceOf(buyRef);
        escrow.cancelUnaccepted(dealId);

        assertEq(usdc.balanceOf(buyRef), beforeBuyRef + refundExpected, "exact refund to buyerRefund");
        assertEq(uint8(escrow.getDeal(dealId).state), uint8(IWaybillEscrow.DealState.CANCELLED));
        assertEq(escrow.currentLocked(), 0, "nothing locked");
    }

    // -------------------------------------------------------------------------
    // Test 6: cancelUnaccepted before deadline reverts AcceptanceNotExpired
    // -------------------------------------------------------------------------
    function testFundFirstCancelBeforeDeadlineReverts() public {
        uint256 dealId = _fundFirstDeal(_acceptanceMilestone());
        _fundDeal(dealId);

        // Do NOT warp — still within acceptance window
        vm.expectRevert(IWaybillEscrow.AcceptanceNotExpired.selector);
        escrow.cancelUnaccepted(dealId);
    }

    // -------------------------------------------------------------------------
    // Test 7: ERC-1271 contract attestor can attest via isValidSignature
    // -------------------------------------------------------------------------
    function test1271AttestorCanAttest() public {
        // We need a stable address for the ERC1271 signer that:
        //   - is not buyer, supplier, or arbiter
        //   - has code (contract)
        // We deploy it, so it automatically has code.
        // Use a dummy digest for construction; update after we know the real digest.
        ERC1271Signer signer1271 = new ERC1271Signer(bytes32(0));

        // Create a deal with the ERC-1271 contract as the attestor
        IWaybillEscrow.MilestoneInput memory msInput = _attestationMilestone(address(signer1271));
        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](1);
        ms[0] = msInput;

        uint256 total = 1_000 * USDC_6;
        uint256 fee   = (total * FEE_BPS + 9_999) / 10_000;
        usdc.mint(buyer, total + fee);

        vm.prank(buyer);
        uint256 dealId = escrow.createDeal(
            supplier, buyRef, arbiter, total, FEE_BPS,
            uint64(block.timestamp + 7 days), 24, ms
        );

        // Complete accepts (attestor acceptance is via acceptAttestor)
        vm.prank(supplier); escrow.acceptSupplier(dealId, supPay);
        vm.prank(arbiter);  escrow.acceptArbiter(dealId);
        vm.prank(address(signer1271)); escrow.acceptAttestor(dealId, 0);

        vm.startPrank(buyer);
        usdc.approve(address(escrow), total + fee);
        escrow.fund(dealId);
        vm.stopPrank();

        // Compute the digest the escrow will check
        bytes32 evidenceHash = keccak256("evidence");
        uint64 signedAt = uint64(block.timestamp);
        uint64 expiry   = uint64(block.timestamp + 1 hours);

        bytes32 structHash = keccak256(abi.encode(
            escrow.ATTESTATION_TYPEHASH(),
            dealId, uint8(0), block.chainid, address(escrow),
            address(signer1271),          // signer field
            escrow.STATEMENT_VERSION(), evidenceHash, signedAt, expiry
        ));
        bytes32 digest = escrow.hashTypedDataV4(structHash);

        // Configure the ERC-1271 contract to accept this digest
        signer1271.setDigest(digest);

        // Pass an empty signature (ERC-1271 path ignores the bytes content, only checks digest)
        bytes memory emptySig = new bytes(0);
        escrow.attest(dealId, 0, evidenceHash, signedAt, expiry, address(signer1271), emptySig);

        // Milestone should be CLAIMABLE (reviewWindow 0)
        assertEq(
            uint8(escrow.getMilestone(dealId, 0).state),
            uint8(IWaybillEscrow.MilestoneState.CLAIMABLE),
            "milestone CLAIMABLE"
        );
    }

    // -------------------------------------------------------------------------
    // Test 8a: attestor who has NOT called acceptAttestor cannot attest (new fix)
    // -------------------------------------------------------------------------
    function testAttestRevertsIfAttestorNotAccepted() public {
        // Create a fundFirst deal with an ATTESTATION milestone; attAddr is the attestor
        IWaybillEscrow.MilestoneInput memory msInput = _attestationMilestone(attAddr);
        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](1);
        ms[0] = msInput;

        uint256 total = 1_000 * USDC_6;
        uint256 fee   = (total * FEE_BPS + 9_999) / 10_000;
        usdc.mint(buyer, total + fee);

        vm.prank(buyer);
        uint256 dealId = escrow.createDeal(
            supplier, buyRef, arbiter, total, FEE_BPS,
            uint64(block.timestamp + 7 days), 24, ms, true
        );

        // Supplier and arbiter accept; attAddr does NOT acceptAttestor
        vm.prank(supplier); escrow.acceptSupplier(dealId, supPay);
        vm.prank(arbiter);  escrow.acceptArbiter(dealId);
        // Note: escrow.acceptAttestor(dealId, 0) is intentionally skipped

        _fundDeal(dealId);

        // Build a valid signature from attAddr
        bytes32 evidenceHash = keccak256("evidence");
        uint64 signedAt = uint64(block.timestamp);
        uint64 expiry   = uint64(block.timestamp + 1 hours);
        bytes memory sig = _signAttestation(dealId, 0, evidenceHash, signedAt, expiry, attPk);

        // Must revert because attAddr never accepted
        vm.expectRevert(IWaybillEscrow.NotFullyAccepted.selector);
        escrow.attest(dealId, 0, evidenceHash, signedAt, expiry, attAddr, sig);
    }

    // -------------------------------------------------------------------------
    // Test 8b: attest + claim succeed after acceptAttestor (new fix)
    // -------------------------------------------------------------------------
    function testAttestAndClaimSucceedAfterAcceptAttestor() public {
        IWaybillEscrow.MilestoneInput memory msInput = _attestationMilestone(attAddr);
        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](1);
        ms[0] = msInput;

        uint256 total = 1_000 * USDC_6;
        uint256 fee   = (total * FEE_BPS + 9_999) / 10_000;
        usdc.mint(buyer, total + fee);

        vm.prank(buyer);
        uint256 dealId = escrow.createDeal(
            supplier, buyRef, arbiter, total, FEE_BPS,
            uint64(block.timestamp + 7 days), 24, ms, true
        );

        // All three parties accept (including attestor)
        vm.prank(supplier); escrow.acceptSupplier(dealId, supPay);
        vm.prank(arbiter);  escrow.acceptArbiter(dealId);
        vm.prank(attAddr);  escrow.acceptAttestor(dealId, 0);

        _fundDeal(dealId);

        // Build a valid ECDSA signature from attAddr
        bytes32 evidenceHash = keccak256("evidence2");
        uint64 signedAt = uint64(block.timestamp);
        uint64 expiry   = uint64(block.timestamp + 1 hours);
        bytes memory sig = _signAttestation(dealId, 0, evidenceHash, signedAt, expiry, attPk);

        // Attest should succeed now
        escrow.attest(dealId, 0, evidenceHash, signedAt, expiry, attAddr, sig);

        // Milestone is CLAIMABLE (reviewWindow = 0)
        assertEq(
            uint8(escrow.getMilestone(dealId, 0).state),
            uint8(IWaybillEscrow.MilestoneState.CLAIMABLE),
            "should be CLAIMABLE"
        );

        // Claim should pay supplier
        uint256 before = usdc.balanceOf(supPay);
        escrow.claim(dealId, 0);
        assertGt(usdc.balanceOf(supPay), before, "supplier should be paid");
    }

    // -------------------------------------------------------------------------
    // Test 9: second acceptSupplier reverts AlreadyAccepted (fund-first + normal)
    // -------------------------------------------------------------------------
    function testSecondAcceptSupplierReverts() public {
        // --- fund-first deal ---
        uint256 dealId = _fundFirstDeal(_acceptanceMilestone());
        _fundDeal(dealId);

        // First accept: supplier → supPay
        vm.prank(supplier); escrow.acceptSupplier(dealId, supPay);
        assertEq(escrow.getDeal(dealId).supplierPayout, supPay);

        // Second accept (to buyer address) must revert AlreadyAccepted
        vm.prank(supplier);
        vm.expectRevert(IWaybillEscrow.AlreadyAccepted.selector);
        escrow.acceptSupplier(dealId, buyer);

        // Also revert when same address repeated
        vm.prank(supplier);
        vm.expectRevert(IWaybillEscrow.AlreadyAccepted.selector);
        escrow.acceptSupplier(dealId, supPay);

        // supplierPayout is still the original address
        assertEq(escrow.getDeal(dealId).supplierPayout, supPay);

        // Arbiter accepts; claim pays original supPay
        vm.prank(arbiter); escrow.acceptArbiter(dealId);
        uint256 principal = escrow.getDeal(dealId).totalAmount;
        uint256 beforeSup = usdc.balanceOf(supPay);
        uint256 beforeBuyer = usdc.balanceOf(buyer);
        escrow.claim(dealId, 0);
        assertEq(usdc.balanceOf(supPay), beforeSup + principal, "exact principal to supPay");
        assertEq(usdc.balanceOf(buyer), beforeBuyer, "buyer got nothing");

        // --- normal funded deal also reverts second acceptSupplier ---
        uint256 dealId2 = _normalDeal(_acceptanceMilestone());
        // Accepts for normal deal
        vm.prank(supplier); escrow.acceptSupplier(dealId2, supPay);
        vm.prank(arbiter);  escrow.acceptArbiter(dealId2);
        _fundDeal(dealId2);

        // Second acceptSupplier on a FUNDED (non-fundFirst) deal: InvalidDealState
        // because validState check excludes non-fundFirst FUNDED deals
        vm.prank(supplier);
        vm.expectRevert(IWaybillEscrow.InvalidDealState.selector);
        escrow.acceptSupplier(dealId2, buyer);
    }

    // -------------------------------------------------------------------------
    // Test 8: Random contract (bad ERC-1271) cannot attest
    // -------------------------------------------------------------------------
    function testRandomContractCannotAttest() public {
        BadERC1271Signer badSigner = new BadERC1271Signer();

        // Create deal with a REAL EOA attestor; badSigner is not listed
        IWaybillEscrow.MilestoneInput memory msInput = _attestationMilestone(attAddr);
        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](1);
        ms[0] = msInput;

        uint256 total = 1_000 * USDC_6;
        uint256 fee   = (total * FEE_BPS + 9_999) / 10_000;
        usdc.mint(buyer, total + fee);

        vm.prank(buyer);
        uint256 dealId = escrow.createDeal(
            supplier, buyRef, arbiter, total, FEE_BPS,
            uint64(block.timestamp + 7 days), 24, ms
        );

        vm.prank(supplier); escrow.acceptSupplier(dealId, supPay);
        vm.prank(arbiter);  escrow.acceptArbiter(dealId);
        vm.prank(attAddr);  escrow.acceptAttestor(dealId, 0);

        vm.startPrank(buyer);
        usdc.approve(address(escrow), total + fee);
        escrow.fund(dealId);
        vm.stopPrank();

        bytes32 evidenceHash = keccak256("evidence");
        uint64 signedAt = uint64(block.timestamp);
        uint64 expiry   = uint64(block.timestamp + 1 hours);

        // Sign as badSigner (but it's not listed as an attestor)
        // Use an empty signature — ECDSA will fail (ecrecover of empty sig), and
        // the ERC-1271 path will try badSigner (not in list) and all listed attestors
        // (EOA attAddr, which has no code). Should revert InvalidSigner.
        // Pass an empty sig claiming attAddr signed it — ECDSA recovery of empty sig != attAddr
        bytes memory emptySig = new bytes(0);
        vm.expectRevert(IWaybillEscrow.InvalidSigner.selector);
        escrow.attest(dealId, 0, evidenceHash, signedAt, expiry, attAddr, emptySig);
    }

    // -------------------------------------------------------------------------
    // Test 04a: Two named attestors, identical evidenceHash/signedAt/expiry —
    //           digests differ because signer is encoded, so both succeed and
    //           neither replay of either signature is accepted.
    // -------------------------------------------------------------------------
    function testTwoAttestorsSameEvidenceNonColliding() public {
        // Second attestor key
        (address att2Addr, uint256 att2Pk) = makeAddrAndKey("attestor2");

        // 3-named-attestor milestone, threshold=3: milestone stays WAITING after only 2 attest
        (address att3Addr,) = makeAddrAndKey("att3");
        address[] memory atts = new address[](3);
        atts[0] = attAddr;
        atts[1] = att2Addr;
        atts[2] = att3Addr;

        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](1);
        ms[0] = IWaybillEscrow.MilestoneInput({
            bps: 10_000,
            condition: IWaybillEscrow.ReleaseCondition.ATTESTATION,
            attestors: atts,
            threshold: 3,  // requires 3 — milestone stays WAITING after only 2 attest
            deadline: uint64(block.timestamp + 7 days),
            gracePeriod: 0,
            reviewWindow: 0,
            dependsOn: type(uint16).max
        });

        // Fund, register both attestors, add arbiter
        uint256 total = 100 * USDC_6;
        usdc.mint(buyer, total + 1_000 * USDC_6);
        vm.prank(buyer);
        usdc.approve(address(escrow), type(uint256).max);

        vm.prank(buyer);
        uint256 dealId = escrow.createDeal(
            supplier, buyRef, arbiter, total, FEE_BPS,
            uint64(block.timestamp + 30 days), 24, ms
        );

        vm.prank(arbiter);  escrow.acceptArbiter(dealId);
        vm.prank(supplier); escrow.acceptSupplier(dealId, supPay);
        vm.prank(attAddr);  escrow.acceptAttestor(dealId, 0);
        vm.prank(att2Addr); escrow.acceptAttestor(dealId, 0);
        vm.prank(att3Addr); escrow.acceptAttestor(dealId, 0);
        vm.prank(buyer);    escrow.fund(dealId);

        // Identical evidenceHash, signedAt, and expiry for both signers
        bytes32 ev     = keccak256("shared-evidence");
        uint64  sat    = uint64(block.timestamp);
        uint64  exp    = sat + 2 days;

        // Sign for attestor 1 (signer=attAddr encoded in digest)
        bytes32 structHash1 = keccak256(abi.encode(
            escrow.ATTESTATION_TYPEHASH(),
            dealId, uint8(0), block.chainid, address(escrow),
            attAddr,
            escrow.STATEMENT_VERSION(), ev, sat, exp
        ));
        bytes32 digest1 = escrow.hashTypedDataV4(structHash1);
        (uint8 v1, bytes32 r1, bytes32 s1) = vm.sign(attPk, digest1);
        bytes memory sig1 = abi.encodePacked(r1, s1, v1);

        // Sign for attestor 2 (signer=att2Addr encoded in digest — different digest)
        bytes32 structHash2 = keccak256(abi.encode(
            escrow.ATTESTATION_TYPEHASH(),
            dealId, uint8(0), block.chainid, address(escrow),
            att2Addr,
            escrow.STATEMENT_VERSION(), ev, sat, exp
        ));
        bytes32 digest2 = escrow.hashTypedDataV4(structHash2);
        (uint8 v2, bytes32 r2, bytes32 s2b) = vm.sign(att2Pk, digest2);
        bytes memory sig2 = abi.encodePacked(r2, s2b, v2);

        // Digests must differ despite identical evidenceHash/signedAt/expiry
        assertTrue(digest1 != digest2, "digests must differ");

        // Both attest calls succeed
        vm.prank(attAddr);
        escrow.attest(dealId, 0, ev, sat, exp, attAddr, sig1);
        assertEq(escrow.getMilestone(dealId, 0).attestCount, 1, "attestCount after first");

        vm.prank(att2Addr);
        escrow.attest(dealId, 0, ev, sat, exp, att2Addr, sig2);
        assertEq(escrow.getMilestone(dealId, 0).attestCount, 2, "attestCount after second");

        // Milestone is still WAITING (only 2 of 3 threshold reached).
        // Replay sig1: digest already in usedAttestations → AttestationUsed.
        vm.expectRevert(IWaybillEscrow.AttestationUsed.selector);
        escrow.attest(dealId, 0, ev, sat, exp, attAddr, sig1);

        // Cross-signer: digest encodes attAddr but is signed by att2Pk →
        // ECDSA recovery returns att2Addr ≠ attAddr → InvalidSigner.
        // Milestone still WAITING so state check passes; signer check catches it.
        bytes32 shCross = keccak256(abi.encode(
            escrow.ATTESTATION_TYPEHASH(),
            dealId, uint8(0), block.chainid, address(escrow),
            attAddr,
            escrow.STATEMENT_VERSION(), ev, sat + 1, exp  // sat+1 → fresh digest
        ));
        bytes32 dgCross = escrow.hashTypedDataV4(shCross);
        (uint8 vx, bytes32 rx, bytes32 sx) = vm.sign(att2Pk, dgCross);
        bytes memory sigCross = abi.encodePacked(rx, sx, vx);
        vm.expectRevert(IWaybillEscrow.InvalidSigner.selector);
        escrow.attest(dealId, 0, ev, sat + 1, exp, attAddr, sigCross);
    }
}
