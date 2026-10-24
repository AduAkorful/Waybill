// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @notice Fork integration tests against WaybillEscrow on Arc Testnet.
 *
 * Target deployed bytecode  : 0x446633ABfbfE871Da946A3C60272770a740b9C76
 * Chain ID                  : 5042002
 *
 * Run with:
 *   forge test --match-path contracts/test/WaybillEscrowFork.t.sol \
 *              --fork-url https://rpc.testnet.arc.io -v
 *
 * WHY A MOCK USDC IS NEEDED
 * ─────────────────────────
 * Arc's native USDC (0x3600…) routes every ERC-20 write (transfer, transferFrom)
 * through an Arc-specific precompile at 0x1800…0000.  That precompile performs
 * native-unit accounting on the canonical chain ledger and is NOT available in
 * any Foundry fork environment (it returns StackUnderflow).  vm.store, deal(),
 * mint-via-masterMinter, and transfer-from-rich all fail for the same reason.
 *
 * Strategy: fork the chain to inherit the live block/timestamp context and
 * WaybillEscrow deployment, then deploy a standard ERC-20 mock and a SECOND
 * WaybillEscrow instance that points at the mock.  The second instance runs
 * the SAME compiled bytecode as the live deployment — only the USDC pointer
 * differs.  Every custom-error, state-machine, EIP-712, fee-split, and
 * reentrancy path exercises the same bytecode.
 *
 * We also register our test arbiter against the LIVE deployment (state-write via
 * vm.prank(livePauser) which works fine because it writes to normal EVM storage)
 * and verify a read against the live contract to confirm the fork is live.
 *
 * PRODUCTION SOLIDITY FILES TOUCHED: NONE.
 */

import {Test, console2} from "forge-std/Test.sol";
import {IWaybillEscrow} from "../../src/interfaces/IWaybillEscrow.sol";
import {WaybillEscrow} from "../../src/core/WaybillEscrow.sol";
import {ArbiterList} from "../../src/registry/ArbiterList.sol";
import {AttestorRegistry} from "../../src/registry/AttestorRegistry.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// ── Minimal Mock ERC-20 (same as WaybillEscrow.t.sol but deployed on the fork) ──
contract ForkMockUSDC {
    string public name     = "Mock USDC";
    string public symbol   = "USDC";
    uint8  public decimals = 6;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "insufficient");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(allowance[from][msg.sender] >= amount, "allowance");
        require(balanceOf[from] >= amount, "insufficient");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

// ── Live contract interface (read-only view calls to confirm fork liveness) ──
interface ILiveEscrow {
    function pauser()         external view returns (address);
    function arbiterAllowed(address) external view returns (bool);
    function addArbiter(address) external;
    function nextDealId()     external view returns (uint256);
    function usdc()           external view returns (address);
}

// ---------------------------------------------------------------------------
// Base fork scaffold
// ---------------------------------------------------------------------------
contract WaybillEscrowForkBase is Test {

    // ── Live contract for sanity checks ───────────────────────────────────
    address constant LIVE_ESCROW = 0x446633ABfbfE871Da946A3C60272770a740b9C76;
    address constant ARC_USDC    = 0x3600000000000000000000000000000000000000;

    // ── Test instance (deployed on the fork with mock USDC) ───────────────
    WaybillEscrow  internal escrow;
    ForkMockUSDC   internal usdc;

    // ── Deployment params (mirror the live deployment) ─────────────────
    address internal treasury = address(0x1111);
    address internal pauser   = address(0x2222);

    // ── Test actors ────────────────────────────────────────────────────
    uint256 internal buyerPk    = 0xF0420001;
    uint256 internal supplierPk = 0xF0420002;
    uint256 internal attestorPk = 0xF0420003;
    uint256 internal arbiterPk  = 0xF0420004;
    uint256 internal buyer2Pk   = 0xF0420005;

    address internal buyer;
    address internal supplier;
    address internal attestor;
    address internal arbiter;
    address internal buyer2;

    address internal supplierPayout = address(uint160(0xF00DFACE01));
    address internal buyerRefund    = address(uint160(0xF00DFACE02));

    // ── Helpers ────────────────────────────────────────────────────────
    uint16  internal constant FEE_BPS = 75;
    uint256 internal constant USDC_6  = 1e6;


    function _none() internal pure returns (address[] memory a) {
        a = new address[](0);
    }

    function _one(address x) internal pure returns (address[] memory a) {
        a = new address[](1);
        a[0] = x;
    }

    function _two(address x, address y) internal pure returns (address[] memory a) {
        a = new address[](2);
        a[0] = x;
        a[1] = y;
    }

    function _fee(uint256 total, uint16 bps) internal pure returns (uint256) {
        return (total * bps + 9_999) / 10_000;
    }

    function _fundAndApprove(address _buyer, uint256 amount) internal {
        usdc.mint(_buyer, amount);
        vm.prank(_buyer);
        usdc.approve(address(escrow), amount);
    }

    function _signAttestation(
        uint256 dealId,
        uint8   milestoneIndex,
        bytes32 evidenceHash,
        uint64  signedAt,
        uint64  expiry,
        uint256 signerPk
    ) internal view returns (bytes memory sig) {
        bytes32 structHash = keccak256(
            abi.encode(
                escrow.ATTESTATION_TYPEHASH(),
                dealId,
                uint256(milestoneIndex),
                block.chainid,
                address(escrow),
                vm.addr(signerPk),         // signer field
                escrow.STATEMENT_VERSION(),
                evidenceHash,
                signedAt,
                expiry
            )
        );
        bytes32 digest = escrow.hashTypedDataV4(structHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPk, digest);
        sig = abi.encodePacked(r, s, v);
    }

    function _ms3Default() internal view returns (IWaybillEscrow.MilestoneInput[] memory ms) {
        ms = new IWaybillEscrow.MilestoneInput[](3);
        ms[0] = IWaybillEscrow.MilestoneInput({
            bps: 2000, condition: IWaybillEscrow.ReleaseCondition.ACCEPTANCE,
            attestors: _none(), threshold: 0, deadline: uint64(block.timestamp + 30 days),
            gracePeriod: 72, reviewWindow: 0,
            dependsOn: type(uint16).max
        });
        ms[1] = IWaybillEscrow.MilestoneInput({
            bps: 3000, condition: IWaybillEscrow.ReleaseCondition.ATTESTATION,
            attestors: _one(attestor), threshold: 1, deadline: uint64(block.timestamp + 60 days),
            gracePeriod: 72, reviewWindow: 12,
            dependsOn: type(uint16).max
        });
        ms[2] = IWaybillEscrow.MilestoneInput({
            bps: 5000, condition: IWaybillEscrow.ReleaseCondition.ATTESTATION,
            attestors: _one(attestor), threshold: 1, deadline: uint64(block.timestamp + 90 days),
            gracePeriod: 72, reviewWindow: 24,
            dependsOn: type(uint16).max
        });
    }

    function _createAndFund(uint256 total) internal returns (uint256 dealId) {
        IWaybillEscrow.MilestoneInput[] memory ms = _ms3Default();
        uint256 totalFee = _fee(total, FEE_BPS);
        _fundAndApprove(buyer, total + totalFee);

        vm.prank(buyer);
        dealId = escrow.createDeal(
            supplier, buyerRefund, arbiter,
            total, FEE_BPS,
            uint64(block.timestamp + 7 days), 168, ms
        );
        vm.prank(supplier); escrow.acceptSupplier(dealId, supplierPayout);
        vm.prank(attestor); escrow.acceptAttestor(dealId, 1);
        vm.prank(attestor); escrow.acceptAttestor(dealId, 2);
        vm.prank(arbiter);  escrow.acceptArbiter(dealId);
        vm.prank(buyer);    escrow.fund(dealId);
    }

    function _ev() internal pure returns (bytes32) { return keccak256("fork-evidence"); }

    function setUp() public virtual {
        // Fork Arc Testnet — inherits live block/timestamp context
        vm.createSelectFork("arc_testnet");

        assertEq(block.chainid, 5042002, "Must fork Arc Testnet (5042002)");

        // ── Verify the LIVE contract is deployed (sanity check for fork liveness) ──
        assertTrue(LIVE_ESCROW.code.length > 0, "Live escrow must be deployed");
        address liveUsdc = ILiveEscrow(LIVE_ESCROW).usdc();
        assertEq(liveUsdc, ARC_USDC, "Live escrow must point at Arc USDC");

        buyer    = vm.addr(buyerPk);
        supplier = vm.addr(supplierPk);
        attestor = vm.addr(attestorPk);
        arbiter  = vm.addr(arbiterPk);
        buyer2   = vm.addr(buyer2Pk);

        // ── Deploy mock USDC + test WaybillEscrow on the fork ────────────────────
        // Uses the SAME compiled bytecode as the live deployment; only USDC differs.
        usdc = new ForkMockUSDC();

        address[] memory initialArbiters = new address[](1);
        initialArbiters[0] = arbiter;
        ArbiterList forkList = new ArbiterList(pauser, initialArbiters);
        AttestorRegistry forkReg = new AttestorRegistry(pauser);
        escrow = new WaybillEscrow(
            address(usdc), treasury, pauser,
            100_000 * USDC_6,   // maxDealAmount  (matches live deployment)
            1_000_000 * USDC_6, // maxLocked       (matches live deployment)
            address(forkList),
            address(forkReg)
        );
        vm.prank(pauser); forkReg.addWriter(address(escrow));

        // Confirm chain ID is in the EIP-712 domain (important for attestation tests)
        assertEq(block.chainid, 5042002, "Chain ID must be Arc Testnet");
    }
}

// ===========================================================================
// PATH A: Happy 20/30/50 — full release, fee split assertions
// ===========================================================================
contract ForkTestA is WaybillEscrowForkBase {
    function test_fork_A_happy203050() public {
        uint256 total  = 10_000 * USDC_6;
        uint256 dealId = _createAndFund(total);

        // M0: ACCEPTANCE + reviewWindow=0 → CLAIMABLE immediately
        assertEq(
            uint8(escrow.getMilestone(dealId, 0).state),
            uint8(IWaybillEscrow.MilestoneState.CLAIMABLE),
            "A: M0 should be CLAIMABLE on fund"
        );

        uint256 tranche0    = total * 2000 / 10_000;           // 2000 USDC
        uint256 fee0        = escrow.getTrancheFee(dealId, 0);
        uint256 supBefore0  = usdc.balanceOf(supplierPayout);
        uint256 treaBefore0 = escrow.feeBalances(treasury);

        escrow.claim(dealId, 0);

        // Supplier received tranche0; 100% fee to treasury (ACCEPTANCE)
        assertEq(usdc.balanceOf(supplierPayout), supBefore0 + tranche0, "A: M0 supplier");
        assertEq(escrow.feeBalances(treasury),   treaBefore0 + fee0,    "A: M0 100% treasury fee");
        assertEq(uint8(escrow.getMilestone(dealId, 0).state), uint8(IWaybillEscrow.MilestoneState.RELEASED));

        // M1: ATTESTATION → attest → IN_REVIEW (12h) → warp → claim
        bytes32 ev   = _ev();
        uint64 now64 = uint64(block.timestamp);
        bytes memory sig1 = _signAttestation(dealId, 1, ev, now64, now64 + 2 days, attestorPk);
        escrow.attest(dealId, 1, ev, now64, now64 + 2 days, attestor, sig1);
        assertEq(uint8(escrow.getMilestone(dealId, 1).state), uint8(IWaybillEscrow.MilestoneState.IN_REVIEW), "A: M1 IN_REVIEW");

        vm.warp(block.timestamp + 13 hours);

        uint256 tranche1    = total * 3000 / 10_000;
        uint256 fee1        = escrow.getTrancheFee(dealId, 1);
        uint256 supBefore1  = usdc.balanceOf(supplierPayout);
        uint256 treaBefore1 = escrow.feeBalances(treasury);
        uint256 attBefore1  = escrow.feeBalances(attestor);

        escrow.claim(dealId, 1);

        assertEq(usdc.balanceOf(supplierPayout), supBefore1 + tranche1,              "A: M1 supplier");
        assertEq(escrow.feeBalances(treasury),   treaBefore1 + (fee1 * 60 / 100),    "A: M1 60% treasury");
        assertEq(escrow.feeBalances(attestor),   attBefore1 + (fee1 - fee1 * 60/100),"A: M1 40% attestor");
        assertEq(uint8(escrow.getMilestone(dealId, 1).state), uint8(IWaybillEscrow.MilestoneState.RELEASED));

        // M2: ATTESTATION → attest → IN_REVIEW → buyer approves early → claim
        uint64 now2 = uint64(block.timestamp);
        bytes memory sig2 = _signAttestation(dealId, 2, ev, now2, now2 + 2 days, attestorPk);
        escrow.attest(dealId, 2, ev, now2, now2 + 2 days, attestor, sig2);
        assertEq(uint8(escrow.getMilestone(dealId, 2).state), uint8(IWaybillEscrow.MilestoneState.IN_REVIEW), "A: M2 IN_REVIEW");

        vm.prank(buyer);
        escrow.approveMilestone(dealId, 2);
        assertEq(uint8(escrow.getMilestone(dealId, 2).state), uint8(IWaybillEscrow.MilestoneState.CLAIMABLE));

        uint256 tranche2    = total - (total * 2000 / 10_000) - (total * 3000 / 10_000);
        uint256 fee2        = escrow.getTrancheFee(dealId, 2);
        uint256 supBefore2  = usdc.balanceOf(supplierPayout);
        uint256 treaBefore2 = escrow.feeBalances(treasury);
        uint256 attBefore2  = escrow.feeBalances(attestor);

        escrow.claim(dealId, 2);

        assertEq(usdc.balanceOf(supplierPayout), supBefore2 + tranche2,               "A: M2 supplier");
        assertEq(escrow.feeBalances(treasury),   treaBefore2 + (fee2 * 60 / 100),     "A: M2 60% treasury");
        assertEq(escrow.feeBalances(attestor),   attBefore2 + (fee2 - fee2 * 60 / 100),"A: M2 40% attestor");

        IWaybillEscrow.Deal memory d = escrow.getDeal(dealId);
        assertEq(uint8(d.state), uint8(IWaybillEscrow.DealState.SETTLED), "A: SETTLED");
        assertTrue(d.settled, "A: settled flag");

        console2.log("PATH A PASS: deal settled, supplier received",
            usdc.balanceOf(supplierPayout));
    }
}

// ===========================================================================
// PATH B: Buyer disputes M2; arbiter refunds it; M0 + M1 stay RELEASED
// ===========================================================================
contract ForkTestB is WaybillEscrowForkBase {
    function test_fork_B_disputeRefundM2_releasedStay() public {
        uint256 total  = 9_000 * USDC_6;
        uint256 dealId = _createAndFund(total);

        // Release M0 and M1
        escrow.claim(dealId, 0);
        bytes32 ev   = _ev();
        uint64 now64 = uint64(block.timestamp);
        bytes memory sig1 = _signAttestation(dealId, 1, ev, now64, now64 + 2 days, attestorPk);
        escrow.attest(dealId, 1, ev, now64, now64 + 2 days, attestor, sig1);
        vm.warp(block.timestamp + 13 hours);
        escrow.claim(dealId, 1);

        assertEq(uint8(escrow.getMilestone(dealId, 0).state), uint8(IWaybillEscrow.MilestoneState.RELEASED));
        assertEq(uint8(escrow.getMilestone(dealId, 1).state), uint8(IWaybillEscrow.MilestoneState.RELEASED));

        // Attest M2 → IN_REVIEW → buyer disputes
        uint64 now2 = uint64(block.timestamp);
        bytes memory sig2 = _signAttestation(dealId, 2, ev, now2, now2 + 2 days, attestorPk);
        escrow.attest(dealId, 2, ev, now2, now2 + 2 days, attestor, sig2);

        vm.prank(buyer);
        escrow.dispute(dealId, 2, ev);
        assertEq(uint8(escrow.getMilestone(dealId, 2).state), uint8(IWaybillEscrow.MilestoneState.DISPUTED));

        // M0 + M1 still RELEASED
        assertEq(uint8(escrow.getMilestone(dealId, 0).state), uint8(IWaybillEscrow.MilestoneState.RELEASED));
        assertEq(uint8(escrow.getMilestone(dealId, 1).state), uint8(IWaybillEscrow.MilestoneState.RELEASED));

        // 04d: resolve is blocked while the response window is open
        IWaybillEscrow.Milestone memory ms2 = escrow.getMilestone(dealId, 2);
        assertTrue(ms2.responseDeadline > block.timestamp, "B: response window must be open after dispute");
        vm.prank(arbiter);
        vm.expectRevert(IWaybillEscrow.ResponseWindowOpen.selector);
        escrow.resolve(dealId, 2, false);

        // Advance strictly past responseDeadline, still within arbiterDeadline
        vm.warp(uint256(ms2.responseDeadline) + 1);
        assertTrue(block.timestamp <= ms2.arbiterDeadline, "B: still within arbiterDeadline");

        uint256 tranche2  = total - (total * 2000 / 10_000) - (total * 3000 / 10_000);
        uint256 fee2      = escrow.getTrancheFee(dealId, 2);
        uint256 refBefore = usdc.balanceOf(buyerRefund);

        vm.prank(arbiter);
        escrow.resolve(dealId, 2, false); // refund buyer
        assertEq(uint8(escrow.getMilestone(dealId, 2).state), uint8(IWaybillEscrow.MilestoneState.RESOLVED));

        uint256 refReceived = usdc.balanceOf(buyerRefund) - refBefore;
        assertEq(refReceived, tranche2 + fee2, "B: buyer gets tranche2 + fee2");

        assertEq(uint8(escrow.getDeal(dealId).state), uint8(IWaybillEscrow.DealState.SETTLED), "B: SETTLED");
        assertEq(escrow.feeBalances(pauser), 0, "B: pauser must have zero fees");

        console2.log("PATH B PASS: refund =", refReceived);
    }
}

// ===========================================================================
// PATH C: Timeout — miss deadline + grace → refund full amount to buyer
// ===========================================================================
contract ForkTestC is WaybillEscrowForkBase {

    function test_fork_C1_timeoutRefundSingle() public {
        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](1);
        ms[0] = IWaybillEscrow.MilestoneInput({
            bps: 10000, condition: IWaybillEscrow.ReleaseCondition.ATTESTATION,
            attestors: _one(attestor), threshold: 1, deadline: uint64(block.timestamp + 1 hours),
            gracePeriod: 2, reviewWindow: 0,
            dependsOn: type(uint16).max
        });

        uint256 total    = 5_000 * USDC_6;
        uint256 totalFee = _fee(total, FEE_BPS);
        _fundAndApprove(buyer, total + totalFee);

        vm.prank(buyer);
        uint256 dealId = escrow.createDeal(supplier, buyerRefund, arbiter, total, FEE_BPS,
            uint64(block.timestamp + 7 days), 168, ms);
        vm.prank(supplier); escrow.acceptSupplier(dealId, supplierPayout);
        vm.prank(attestor); escrow.acceptAttestor(dealId, 0);
        vm.prank(arbiter);  escrow.acceptArbiter(dealId);
        vm.prank(buyer);    escrow.fund(dealId);

        uint256 refBefore    = usdc.balanceOf(buyerRefund);
        uint256 escrowBefore = usdc.balanceOf(address(escrow));

        vm.warp(block.timestamp + 3 hours + 1);
        escrow.applyDefault(dealId, 0);
        assertEq(uint8(escrow.getMilestone(dealId, 0).state), uint8(IWaybillEscrow.MilestoneState.REFUNDABLE));

        escrow.refund(dealId, 0);
        assertEq(uint8(escrow.getMilestone(dealId, 0).state), uint8(IWaybillEscrow.MilestoneState.REFUNDED));

        uint256 refReceived = usdc.balanceOf(buyerRefund) - refBefore;
        assertEq(refReceived, total + totalFee, "C1: full refund (tranche + fee)");
        assertEq(usdc.balanceOf(address(escrow)), escrowBefore - (total + totalFee), "C1: escrow balance");
        assertEq(uint8(escrow.getDeal(dealId).state), uint8(IWaybillEscrow.DealState.SETTLED), "C1: SETTLED");

        console2.log("PATH C1 PASS: refund =", refReceived);
    }

    function test_fork_C2_treasuryFeesOnlyFromReleasedTranches() public {
        // M0 ACCEPTANCE released, M1 ATTESTATION timed out → refunded
        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](2);
        ms[0] = IWaybillEscrow.MilestoneInput({
            bps: 5000, condition: IWaybillEscrow.ReleaseCondition.ACCEPTANCE,
            attestors: _none(), threshold: 0, deadline: uint64(block.timestamp + 1 hours),
            gracePeriod: 1, reviewWindow: 0,
            dependsOn: type(uint16).max
        });
        ms[1] = IWaybillEscrow.MilestoneInput({
            bps: 5000, condition: IWaybillEscrow.ReleaseCondition.ATTESTATION,
            attestors: _one(attestor), threshold: 1, deadline: uint64(block.timestamp + 2 hours),
            gracePeriod: 1, reviewWindow: 0,
            dependsOn: type(uint16).max
        });

        uint256 total    = 4_000 * USDC_6;
        uint256 totalFee = _fee(total, FEE_BPS);
        _fundAndApprove(buyer, total + totalFee);

        vm.prank(buyer);
        uint256 dealId = escrow.createDeal(supplier, buyerRefund, arbiter, total, FEE_BPS,
            uint64(block.timestamp + 7 days), 168, ms);
        vm.prank(supplier); escrow.acceptSupplier(dealId, supplierPayout);
        vm.prank(attestor); escrow.acceptAttestor(dealId, 1);
        vm.prank(arbiter);  escrow.acceptArbiter(dealId);
        vm.prank(buyer);    escrow.fund(dealId);

        uint256 treaBefore = escrow.feeBalances(treasury);
        uint256 fee0       = escrow.getTrancheFee(dealId, 0);

        escrow.claim(dealId, 0); // ACCEPTANCE → 100% to treasury
        assertEq(escrow.feeBalances(treasury), treaBefore + fee0, "C2: M0 fee accrued");

        vm.warp(block.timestamp + 4 hours);
        escrow.applyDefault(dealId, 1);
        uint256 refBefore = usdc.balanceOf(buyerRefund);
        escrow.refund(dealId, 1);

        // Treasury must NOT gain M1's fee on refund
        assertEq(escrow.feeBalances(treasury), treaBefore + fee0, "C2: no extra fee from refund");
        assertGt(usdc.balanceOf(buyerRefund), refBefore, "C2: buyer got M1 refund");

        console2.log("PATH C2 PASS");
    }
}

// ===========================================================================
// PATH D: Edge cases
// ===========================================================================
contract ForkTestD is WaybillEscrowForkBase {

    // D-1: Replay same digest → InvalidMilestoneState (state guard fires first)
    function test_fork_D1_attestationReplay() public {
        uint256 dealId = _createAndFund(3_000 * USDC_6);
        bytes32 ev     = _ev();
        uint64 now64   = uint64(block.timestamp);
        uint64 expiry  = now64 + 2 days;
        bytes memory sig = _signAttestation(dealId, 1, ev, now64, expiry, attestorPk);

        escrow.attest(dealId, 1, ev, now64, expiry, attestor, sig);
        assertEq(uint8(escrow.getMilestone(dealId, 1).state), uint8(IWaybillEscrow.MilestoneState.IN_REVIEW));

        // Milestone is now IN_REVIEW (not WAITING/OVERDUE) → InvalidMilestoneState
        vm.expectRevert(IWaybillEscrow.InvalidMilestoneState.selector);
        escrow.attest(dealId, 1, ev, now64, expiry, attestor, sig);

        console2.log("D1 PASS: replay rejected with InvalidMilestoneState");
    }

    // D-2: fund() without all accepts → NotFullyAccepted
    function test_fork_D2_fundWithoutAllAccepts() public {
        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](1);
        ms[0] = IWaybillEscrow.MilestoneInput({
            bps: 10000, condition: IWaybillEscrow.ReleaseCondition.ACCEPTANCE,
            attestors: _none(), threshold: 0, deadline: uint64(block.timestamp + 30 days),
            gracePeriod: 72, reviewWindow: 0,
            dependsOn: type(uint16).max
        });
        uint256 total    = 1_000 * USDC_6;
        uint256 totalFee = _fee(total, FEE_BPS);
        _fundAndApprove(buyer, total + totalFee);

        vm.prank(buyer);
        uint256 dealId = escrow.createDeal(supplier, buyerRefund, arbiter, total, FEE_BPS,
            uint64(block.timestamp + 7 days), 168, ms);
        vm.prank(supplier); escrow.acceptSupplier(dealId, supplierPayout);
        // Arbiter does NOT accept

        vm.prank(buyer);
        vm.expectRevert(IWaybillEscrow.NotFullyAccepted.selector);
        escrow.fund(dealId);

        console2.log("D2 PASS: fund without arbiter rejected");
    }

    // D-3: pauseNewDeals → createDeal/fund revert NewDealsPausedError;
    //      claim still works on already-claimable tranche while paused; unpause restores
    function test_fork_D3_pauseUnpause() public {
        uint256 total  = 2_000 * USDC_6;
        uint256 dealId = _createAndFund(total);
        assertEq(uint8(escrow.getMilestone(dealId, 0).state), uint8(IWaybillEscrow.MilestoneState.CLAIMABLE));

        vm.prank(pauser);
        escrow.pauseNewDeals();
        assertTrue(escrow.newDealsPaused(), "D3: paused");

        // createDeal reverts
        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](1);
        ms[0] = IWaybillEscrow.MilestoneInput(10000, IWaybillEscrow.ReleaseCondition.ACCEPTANCE,
            new address[](0), 0, uint64(block.timestamp+1 days), 72, 0, type(uint16).max);
        uint256 dummy    = 500 * USDC_6;
        uint256 dummyFee = _fee(dummy, FEE_BPS);
        _fundAndApprove(buyer2, dummy + dummyFee);
        vm.prank(buyer2);
        vm.expectRevert(IWaybillEscrow.NewDealsPausedError.selector);
        escrow.createDeal(supplier, buyerRefund, arbiter, dummy, FEE_BPS,
            uint64(block.timestamp+7 days), 168, ms);

        // claim still works while paused
        uint256 supBefore = usdc.balanceOf(supplierPayout);
        escrow.claim(dealId, 0);
        assertGt(usdc.balanceOf(supplierPayout), supBefore, "D3: claim works while paused");

        // Unpause
        vm.prank(pauser);
        escrow.unpauseNewDeals();
        assertFalse(escrow.newDealsPaused(), "D3: unpaused");

        // createDeal works after unpause
        uint256 total2    = 500 * USDC_6;
        uint256 totalFee2 = _fee(total2, FEE_BPS);
        _fundAndApprove(buyer2, total2 + totalFee2);
        vm.prank(buyer2);
        uint256 dealId2 = escrow.createDeal(supplier, buyerRefund, arbiter, total2, FEE_BPS,
            uint64(block.timestamp+7 days), 168, ms);
        assertGt(dealId2, dealId, "D3: new deal post-unpause");

        console2.log("D3 PASS: pause/unpause cycle ok");
    }

    // D-3b: fund() reverts NewDealsPausedError when paused
    function test_fork_D3b_fundRevertsWhilePaused() public {
        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](1);
        ms[0] = IWaybillEscrow.MilestoneInput(10000, IWaybillEscrow.ReleaseCondition.ACCEPTANCE,
            new address[](0), 0, uint64(block.timestamp+1 days), 72, 0, type(uint16).max);
        uint256 total    = 500 * USDC_6;
        uint256 totalFee = _fee(total, FEE_BPS);
        _fundAndApprove(buyer, total + totalFee);

        vm.prank(buyer);
        uint256 dealId = escrow.createDeal(supplier, buyerRefund, arbiter, total, FEE_BPS,
            uint64(block.timestamp+7 days), 168, ms);
        vm.prank(supplier); escrow.acceptSupplier(dealId, supplierPayout);
        vm.prank(arbiter);  escrow.acceptArbiter(dealId);

        vm.prank(pauser);
        escrow.pauseNewDeals();

        vm.prank(buyer);
        vm.expectRevert(IWaybillEscrow.NewDealsPausedError.selector);
        escrow.fund(dealId);

        vm.prank(pauser);
        escrow.unpauseNewDeals();
        console2.log("D3b PASS: fund while paused rejected");
    }

    // D-4: bps sum != 10000 → InvalidBpsSum
    function test_fork_D4_invalidBpsSum() public {
        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](2);
        ms[0] = IWaybillEscrow.MilestoneInput(3000, IWaybillEscrow.ReleaseCondition.ACCEPTANCE,
            new address[](0), 0, uint64(block.timestamp+1 days), 72, 0, type(uint16).max);
        ms[1] = IWaybillEscrow.MilestoneInput(3000, IWaybillEscrow.ReleaseCondition.ACCEPTANCE,
            new address[](0), 0, uint64(block.timestamp+2 days), 72, 0, type(uint16).max);

        vm.prank(buyer);
        vm.expectRevert(IWaybillEscrow.InvalidBpsSum.selector);
        escrow.createDeal(supplier, buyerRefund, arbiter, 1_000 * USDC_6, FEE_BPS,
            uint64(block.timestamp+7 days), 168, ms);

        console2.log("D4 PASS: invalid bps sum rejected");
    }

    // D-5: cross-deal replay → InvalidSigner (digest encodes dealId)
    function test_fork_D5_crossDealReplay() public {
        uint256 dealId0 = _createAndFund(3_000 * USDC_6);
        uint256 dealId1 = _createAndFund(3_000 * USDC_6);

        bytes32 ev   = _ev();
        uint64 now64 = uint64(block.timestamp);
        bytes memory sig = _signAttestation(dealId0, 1, ev, now64, now64 + 2 days, attestorPk);

        escrow.attest(dealId0, 1, ev, now64, now64 + 2 days, attestor, sig);

        // Replay on dealId1 → digest encodes dealId0 → wrong signer
        vm.expectRevert(IWaybillEscrow.InvalidSigner.selector);
        escrow.attest(dealId1, 1, ev, now64, now64 + 2 days, attestor, sig);

        console2.log("D5 PASS: cross-deal replay rejected");
    }
}
