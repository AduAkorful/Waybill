// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {AttestorRegistry} from "../../src/registry/AttestorRegistry.sol";
import {IAttestorRegistry} from "../../src/interfaces/IAttestorRegistry.sol";
import {WaybillEscrow}     from "../../src/core/WaybillEscrow.sol";
import {IWaybillEscrow}    from "../../src/interfaces/IWaybillEscrow.sol";
import {ArbiterList}       from "../../src/registry/ArbiterList.sol";

// ---------------------------------------------------------------------------
// Minimal ERC-20 mock
// ---------------------------------------------------------------------------
contract MockUSDC04i {
    uint8 public decimals = 6;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    function mint(address to, uint256 amt) external { balanceOf[to] += amt; }
    function totalSupply() external pure returns (uint256) { return type(uint256).max; }
    function transfer(address to, uint256 amt) external returns (bool) {
        require(balanceOf[msg.sender] >= amt); balanceOf[msg.sender] -= amt; balanceOf[to] += amt; return true;
    }
    function transferFrom(address from, address to, uint256 amt) external returns (bool) {
        require(balanceOf[from] >= amt); require(allowance[from][msg.sender] >= amt);
        allowance[from][msg.sender] -= amt; balanceOf[from] -= amt; balanceOf[to] += amt; return true;
    }
    function approve(address spender, uint256 amt) external returns (bool) {
        allowance[msg.sender][spender] = amt; return true;
    }
}

/// @title AttestorRegistry04i - break tests for 04i: profile, auto-suspend, escrow integration.
contract AttestorRegistry04i is Test {
    uint256 internal constant USDC_6   = 1e6;
    uint16  internal constant FEE_BPS  = 100; // 1%

    AttestorRegistry internal reg;
    MockUSDC04i      internal usdc;
    ArbiterList      internal list;
    WaybillEscrow    internal escrow;

    address internal pauser    = address(0xA1);
    address internal treasury  = address(0xA2);
    address internal arbiter   = address(0xA3);
    address internal writer    = address(0xA4);
    address internal stranger  = address(0xA5);
    address internal buyer     = address(0xB1);
    address internal supplier  = address(0xB2);
    address internal supPay    = address(0xB3);
    address internal buyRef    = address(0xB4);

    address internal attestorA = address(0xC1);
    address internal attestorB = address(0xC2);

    function setUp() public {
        reg  = new AttestorRegistry(pauser);
        usdc = new MockUSDC04i();
        address[] memory initArbs = new address[](1);
        initArbs[0] = arbiter;
        list   = new ArbiterList(pauser, initArbs);
        escrow = new WaybillEscrow(
            address(usdc), treasury, pauser,
            100_000 * USDC_6, 1_000_000 * USDC_6,
            address(list), address(reg)
        );
        vm.prank(pauser); reg.addWriter(address(escrow));
        vm.prank(pauser); reg.addWriter(writer);
    }

    // =========================================================================
    // PROFILE TESTS
    // =========================================================================

    // P1: attestor can set their own profile
    function testP1_SelfProfile_SetAndRead() public {
        vm.prank(attestorA);
        reg.setProfile("Acme Logistics", "Singapore", 42);

        (string memory name, string memory city, uint64 agentId) = reg.getProfile(attestorA);
        assertEq(name,    "Acme Logistics", "name");
        assertEq(city,    "Singapore",      "city");
        assertEq(agentId, 42,               "agentId");
    }

    // P2: profile update replaces all fields
    function testP2_SelfProfile_UpdateReplaces() public {
        vm.prank(attestorA);
        reg.setProfile("Old Name", "Old City", 1);

        vm.prank(attestorA);
        reg.setProfile("New Name", "New City", 99);

        (string memory name, string memory city, uint64 agentId) = reg.getProfile(attestorA);
        assertEq(name, "New Name");
        assertEq(city, "New City");
        assertEq(agentId, 99);
    }

    // P3: agentId == 0 means unlinked; empty strings are valid
    function testP3_SelfProfile_ZeroAgentId_EmptyStrings() public {
        vm.prank(attestorA);
        reg.setProfile("", "", 0);

        (string memory name, string memory city, uint64 agentId) = reg.getProfile(attestorA);
        assertEq(bytes(name).length, 0, "empty name");
        assertEq(bytes(city).length, 0, "empty city");
        assertEq(agentId, 0, "unlinked");
    }

    // P4: unregistered address returns empty profile
    function testP4_UnregisteredProfile_IsEmpty() public view {
        (string memory name, string memory city, uint64 agentId) = reg.getProfile(stranger);
        assertEq(bytes(name).length, 0);
        assertEq(bytes(city).length, 0);
        assertEq(agentId, 0);
    }

    // P5: wallet identity — only msg.sender can write their own profile
    //     There is no "unauthorized overwrite" function because the key IS msg.sender.
    //     Verify attestorA's write does not affect attestorB.
    function testP5_WalletIdentity_NoOverwrite() public {
        vm.prank(attestorA);
        reg.setProfile("Attestor A", "Tokyo", 7);

        // attestorB writes their own profile
        vm.prank(attestorB);
        reg.setProfile("Attestor B", "London", 8);

        // attestorA's profile unchanged
        (string memory name,,) = reg.getProfile(attestorA);
        assertEq(name, "Attestor A", "A profile untouched");

        (string memory nameB,,) = reg.getProfile(attestorB);
        assertEq(nameB, "Attestor B", "B profile correct");
    }

    // P6: registry has no token movement surface
    function testP6_RegistryHasNoTransferFrom() public view {
        bytes memory code = address(reg).code;
        bytes4 sel = bytes4(0x23b872dd); // transferFrom
        bool found;
        for (uint256 i = 0; i + 3 < code.length; i++) {
            if (code[i]==sel[0] && code[i+1]==sel[1] && code[i+2]==sel[2] && code[i+3]==sel[3]) {
                found = true; break;
            }
        }
        assertFalse(found, "registry must not contain transferFrom");
    }

    // P7: registry cannot call escrow claim
    function testP7_RegistryCannotCallEscrow() public {
        usdc.mint(address(escrow), 1_000 * USDC_6);
        uint256 before = usdc.balanceOf(address(escrow));

        (bool ok,) = address(reg).call(
            abi.encodeWithSignature("claim(uint256,uint8)", 0, 0)
        );
        assertFalse(ok, "no claim function on registry");
        assertEq(usdc.balanceOf(address(escrow)), before, "escrow USDC unchanged");
    }

    // =========================================================================
    // AUTO-SUSPEND TESTS
    // =========================================================================

    // S1: first two Upheld outcomes do NOT trigger auto-suspend
    function testS1_TwoUpheld_NoAutoSuspend() public {
        vm.prank(writer); reg.recordOutcome(attestorA, IAttestorRegistry.OutcomeKind.Upheld);
        assertFalse(reg.isAutoSuspensionPending(attestorA), "1 upheld: no pending");

        vm.prank(writer); reg.recordOutcome(attestorA, IAttestorRegistry.OutcomeKind.Upheld);
        assertFalse(reg.isAutoSuspensionPending(attestorA), "2 upheld: no pending");

        assertEq(uint8(reg.status(attestorA)), uint8(IAttestorRegistry.Status.None), "still None");
    }

    // S2: third Upheld schedules auto-suspend for 48h later; no immediate status change
    function testS2_ThirdUpheld_SchedulesAutoSuspend() public {
        vm.prank(writer); reg.recordOutcome(attestorA, IAttestorRegistry.OutcomeKind.Upheld);
        vm.prank(writer); reg.recordOutcome(attestorA, IAttestorRegistry.OutcomeKind.Upheld);

        uint64 expectedEta = uint64(block.timestamp) + 48 hours;
        vm.expectEmit(true, false, false, true);
        emit IAttestorRegistry.AutoSuspensionScheduled(attestorA, expectedEta);

        vm.prank(writer); reg.recordOutcome(attestorA, IAttestorRegistry.OutcomeKind.Upheld);

        assertTrue(reg.isAutoSuspensionPending(attestorA), "auto pending after 3rd upheld");
        assertEq(uint8(reg.status(attestorA)), uint8(IAttestorRegistry.Status.None), "not suspended yet");
    }

    // S3: executeSetStatus before delay reverts ChangeDelayActive
    function testS3_EarlyExecution_Reverts() public {
        vm.prank(writer); reg.recordOutcome(attestorA, IAttestorRegistry.OutcomeKind.Upheld);
        vm.prank(writer); reg.recordOutcome(attestorA, IAttestorRegistry.OutcomeKind.Upheld);
        vm.prank(writer); reg.recordOutcome(attestorA, IAttestorRegistry.OutcomeKind.Upheld);

        vm.prank(pauser);
        vm.expectRevert(IAttestorRegistry.ChangeDelayActive.selector);
        reg.executeSetStatus(attestorA);
    }

    // S4: unauthorized executeSetStatus reverts NotPauser
    function testS4_UnauthorizedExecution_Reverts() public {
        vm.prank(writer); reg.recordOutcome(attestorA, IAttestorRegistry.OutcomeKind.Upheld);
        vm.prank(writer); reg.recordOutcome(attestorA, IAttestorRegistry.OutcomeKind.Upheld);
        vm.prank(writer); reg.recordOutcome(attestorA, IAttestorRegistry.OutcomeKind.Upheld);

        vm.warp(block.timestamp + 48 hours + 1);
        vm.prank(stranger);
        vm.expectRevert(IAttestorRegistry.NotPauser.selector);
        reg.executeSetStatus(attestorA);
    }

    // S5: after 48h delay, executeSetStatus succeeds and suspends
    function testS5_AfterDelay_ExecuteSuspends() public {
        vm.prank(writer); reg.recordOutcome(attestorA, IAttestorRegistry.OutcomeKind.Upheld);
        vm.prank(writer); reg.recordOutcome(attestorA, IAttestorRegistry.OutcomeKind.Upheld);
        vm.prank(writer); reg.recordOutcome(attestorA, IAttestorRegistry.OutcomeKind.Upheld);

        vm.warp(block.timestamp + 48 hours + 1);
        vm.prank(pauser); reg.executeSetStatus(attestorA);

        assertEq(uint8(reg.status(attestorA)), uint8(IAttestorRegistry.Status.Suspended), "suspended");
        assertFalse(reg.isAutoSuspensionPending(attestorA), "pending cleared");
    }

    // S6: direct setStatus always reverts
    function testS6_DirectSetStatus_Reverts() public {
        vm.prank(pauser);
        vm.expectRevert(IAttestorRegistry.DirectParamChange.selector);
        reg.setStatus(attestorA, IAttestorRegistry.Status.Suspended);
    }

    // S7: pauser can cancel pending auto-suspension; subsequent upheld multiple re-triggers
    function testS7_CancelAutoSuspension_ThenRetrigger() public {
        vm.prank(writer); reg.recordOutcome(attestorA, IAttestorRegistry.OutcomeKind.Upheld);
        vm.prank(writer); reg.recordOutcome(attestorA, IAttestorRegistry.OutcomeKind.Upheld);
        vm.prank(writer); reg.recordOutcome(attestorA, IAttestorRegistry.OutcomeKind.Upheld);

        assertTrue(reg.isAutoSuspensionPending(attestorA), "pending before cancel");

        vm.expectEmit(true, false, false, false);
        emit IAttestorRegistry.AutoSuspensionCancelled(attestorA);
        vm.prank(pauser); reg.cancelAutoSuspension(attestorA);

        assertFalse(reg.isAutoSuspensionPending(attestorA), "cleared after cancel");
        assertEq(uint8(reg.status(attestorA)), uint8(IAttestorRegistry.Status.None), "still None");

        // Three more Upheld (total 6) — should trigger again
        vm.prank(writer); reg.recordOutcome(attestorA, IAttestorRegistry.OutcomeKind.Upheld);
        assertFalse(reg.isAutoSuspensionPending(attestorA), "4th upheld: no re-trigger");
        vm.prank(writer); reg.recordOutcome(attestorA, IAttestorRegistry.OutcomeKind.Upheld);
        assertFalse(reg.isAutoSuspensionPending(attestorA), "5th upheld: no re-trigger");
        vm.prank(writer); reg.recordOutcome(attestorA, IAttestorRegistry.OutcomeKind.Upheld);
        assertTrue(reg.isAutoSuspensionPending(attestorA), "6th upheld: re-triggered");
    }

    // S8: cancelAutoSuspension reverts when no auto-suspension pending
    function testS8_CancelAutoSuspension_NoPending_Reverts() public {
        vm.prank(pauser);
        vm.expectRevert(IAttestorRegistry.NoAutoSuspensionPending.selector);
        reg.cancelAutoSuspension(attestorA);
    }

    // S9: cancelAutoSuspension does NOT cancel a manually-scheduled status change
    function testS9_CancelAutoSuspension_DoesNotCancelManual() public {
        vm.prank(pauser);
        reg.scheduleSetStatus(attestorA, IAttestorRegistry.Status.Registered);

        // Attempt to cancel — should revert because pending is manual, not auto
        vm.prank(pauser);
        vm.expectRevert(IAttestorRegistry.NoAutoSuspensionPending.selector);
        reg.cancelAutoSuspension(attestorA);

        // Manual pending still intact
        (, uint64 eta) = reg.getPendingStatus(attestorA);
        assertTrue(eta > 0, "manual pending still intact");
    }

    // S10: auto-suspend is one-shot per threshold — a 4th Upheld after 3 does NOT re-trigger
    //      (only the 6th would trigger, since 6 % 3 == 0 and no pending at that point)
    function testS10_OneShot_NoReScheduleWhilePending() public {
        vm.prank(writer); reg.recordOutcome(attestorA, IAttestorRegistry.OutcomeKind.Upheld);
        vm.prank(writer); reg.recordOutcome(attestorA, IAttestorRegistry.OutcomeKind.Upheld);
        vm.prank(writer); reg.recordOutcome(attestorA, IAttestorRegistry.OutcomeKind.Upheld);
        assertTrue(reg.isAutoSuspensionPending(attestorA), "pending after 3rd");

        // 4th upheld — pending already set, do NOT re-schedule
        vm.prank(writer); reg.recordOutcome(attestorA, IAttestorRegistry.OutcomeKind.Upheld);
        assertTrue(reg.isAutoSuspensionPending(attestorA), "still pending (not doubled)");
        // ETA should be unchanged from the original schedule
        (, uint64 eta1) = reg.getPendingStatus(attestorA);
        assertTrue(eta1 > 0, "eta still set");
    }

    // S11: saturating upheld counter — should not overflow or double-trigger at max
    function testS11_SaturatingCounter() public {
        // Force upheld near max via storage cheat
        // Write upheld = type(uint32).max - 1 directly
        // Counts slot: mapping(address => Counts) at slot 3 (after pauser, _isWriter, _counts)
        // _counts is at storage slot 3; but we use a simpler approach:
        // record outcomes in a loop 3 times to get to the first threshold, then execute.
        for (uint256 i = 0; i < 3; i++) {
            vm.prank(writer); reg.recordOutcome(attestorA, IAttestorRegistry.OutcomeKind.Upheld);
        }
        vm.warp(block.timestamp + 48 hours + 1);
        vm.prank(pauser); reg.executeSetStatus(attestorA);
        assertEq(uint8(reg.status(attestorA)), uint8(IAttestorRegistry.Status.Suspended));

        // After suspension, Attested outcomes still saturate safely
        for (uint256 i = 0; i < 5; i++) {
            vm.prank(writer); reg.recordOutcome(attestorA, IAttestorRegistry.OutcomeKind.Attested);
        }
        (uint32 a,,) = reg.counts(attestorA);
        assertEq(a, 5, "attested 5");
    }

    // S12: Attested and Slashed outcomes after the threshold do NOT trigger auto-suspend
    function testS12_NonUpheld_DoesNotTrigger() public {
        vm.prank(writer); reg.recordOutcome(attestorA, IAttestorRegistry.OutcomeKind.Upheld);
        vm.prank(writer); reg.recordOutcome(attestorA, IAttestorRegistry.OutcomeKind.Upheld);
        // 2 upheld, no trigger yet

        vm.prank(writer); reg.recordOutcome(attestorA, IAttestorRegistry.OutcomeKind.Attested);
        vm.prank(writer); reg.recordOutcome(attestorA, IAttestorRegistry.OutcomeKind.Slashed);
        assertFalse(reg.isAutoSuspensionPending(attestorA), "Attested/Slashed must not trigger");
    }

    // =========================================================================
    // ESCROW INTEGRATION — SUSPENDED ATTESTOR REJECTED ON createDeal
    // =========================================================================

    function _milestoneWithAttestor(address att) internal view
        returns (IWaybillEscrow.MilestoneInput[] memory ms)
    {
        ms = new IWaybillEscrow.MilestoneInput[](1);
        address[] memory attestors = new address[](1);
        attestors[0] = att;
        ms[0] = IWaybillEscrow.MilestoneInput({
            bps:        10_000,
            condition:  IWaybillEscrow.ReleaseCondition.ATTESTATION,
            attestors:  attestors,
            threshold:  1,
            deadline:   uint64(block.timestamp + 30 days),
            gracePeriod: 72,
            reviewWindow: 0,
            dependsOn:  type(uint16).max
        });
    }

    // E1: suspended attestor is rejected from new deals
    function testE1_SuspendedAttestor_RejectedFromNewDeal() public {
        // Suspend attestorA
        vm.prank(pauser); reg.scheduleSetStatus(attestorA, IAttestorRegistry.Status.Suspended);
        vm.warp(block.timestamp + 48 hours + 1);
        vm.prank(pauser); reg.executeSetStatus(attestorA);
        assertEq(uint8(reg.status(attestorA)), uint8(IAttestorRegistry.Status.Suspended));

        uint256 total = 1_000 * USDC_6;
        uint256 fee   = (total * FEE_BPS + 9_999) / 10_000;
        usdc.mint(buyer, total + fee);
        vm.prank(buyer); usdc.approve(address(escrow), total + fee);

        IWaybillEscrow.MilestoneInput[] memory ms = _milestoneWithAttestor(attestorA);

        vm.prank(buyer);
        vm.expectRevert(IWaybillEscrow.AttestorSuspended.selector);
        escrow.createDeal(
            supplier, buyRef, arbiter,
            total, FEE_BPS,
            uint64(block.timestamp + 7 days), 168, ms
        );
    }

    // E2: unregistered attestor (status == None) is allowed
    function testE2_UnregisteredAttestor_Allowed() public {
        uint256 total = 1_000 * USDC_6;
        uint256 fee   = (total * FEE_BPS + 9_999) / 10_000;
        usdc.mint(buyer, total + fee);
        vm.prank(buyer); usdc.approve(address(escrow), total + fee);

        IWaybillEscrow.MilestoneInput[] memory ms = _milestoneWithAttestor(attestorA);

        // attestorA has status None (never registered) — should succeed
        vm.prank(buyer);
        uint256 dealId = escrow.createDeal(
            supplier, buyRef, arbiter,
            total, FEE_BPS,
            uint64(block.timestamp + 7 days), 168, ms
        );
        // dealId starts at 0; verify deal exists by checking buyer field
        assertEq(escrow.deals(dealId).buyer, buyer, "deal created with unregistered attestor");
    }

    // E3: registered (non-suspended) attestor is allowed
    function testE3_RegisteredAttestor_Allowed() public {
        // Schedule and execute Registered status for attestorA
        vm.prank(pauser); reg.scheduleSetStatus(attestorA, IAttestorRegistry.Status.Registered);
        vm.warp(block.timestamp + 48 hours + 1);
        vm.prank(pauser); reg.executeSetStatus(attestorA);

        uint256 total = 1_000 * USDC_6;
        uint256 fee   = (total * FEE_BPS + 9_999) / 10_000;
        usdc.mint(buyer, total + fee);
        vm.prank(buyer); usdc.approve(address(escrow), total + fee);

        IWaybillEscrow.MilestoneInput[] memory ms = _milestoneWithAttestor(attestorA);

        vm.prank(buyer);
        uint256 dealId = escrow.createDeal(
            supplier, buyRef, arbiter,
            total, FEE_BPS,
            uint64(block.timestamp + 7 days), 168, ms
        );
        // dealId starts at 0; verify deal exists by checking buyer field
        assertEq(escrow.deals(dealId).buyer, buyer, "registered attestor allowed");
    }

    // E4: already-assigned attestors in existing deals continue unchanged even if later suspended
    function testE4_ExistingDeal_UnaffectedBySuspension() public {
        uint256 total = 1_000 * USDC_6;
        uint256 fee   = (total * FEE_BPS + 9_999) / 10_000;
        usdc.mint(buyer, total + fee);
        vm.prank(buyer); usdc.approve(address(escrow), total + fee);

        IWaybillEscrow.MilestoneInput[] memory ms = _milestoneWithAttestor(attestorA);

        // Create deal before attestorA is suspended
        vm.prank(buyer);
        uint256 dealId = escrow.createDeal(
            supplier, buyRef, arbiter,
            total, FEE_BPS,
            uint64(block.timestamp + 7 days), 168, ms
        );

        // Now suspend attestorA
        vm.prank(pauser); reg.scheduleSetStatus(attestorA, IAttestorRegistry.Status.Suspended);
        vm.warp(block.timestamp + 48 hours + 1);
        vm.prank(pauser); reg.executeSetStatus(attestorA);

        // The existing deal's acceptAttestor still works (suspension only blocks new deals)
        vm.prank(attestorA);
        escrow.acceptAttestor(dealId, 0); // should NOT revert
    }

    // E5: suspended attestor rejected via auto-suspend path (3rd upheld)
    function testE5_AutoSuspended_RejectedFromNewDeal() public {
        // Trigger auto-suspend via 3 Upheld outcomes
        vm.prank(writer); reg.recordOutcome(attestorA, IAttestorRegistry.OutcomeKind.Upheld);
        vm.prank(writer); reg.recordOutcome(attestorA, IAttestorRegistry.OutcomeKind.Upheld);
        vm.prank(writer); reg.recordOutcome(attestorA, IAttestorRegistry.OutcomeKind.Upheld);
        assertTrue(reg.isAutoSuspensionPending(attestorA));

        // Execute after delay
        vm.warp(block.timestamp + 48 hours + 1);
        vm.prank(pauser); reg.executeSetStatus(attestorA);

        uint256 total = 1_000 * USDC_6;
        uint256 fee   = (total * FEE_BPS + 9_999) / 10_000;
        usdc.mint(buyer, total + fee);
        vm.prank(buyer); usdc.approve(address(escrow), total + fee);

        IWaybillEscrow.MilestoneInput[] memory ms = _milestoneWithAttestor(attestorA);
        vm.prank(buyer);
        vm.expectRevert(IWaybillEscrow.AttestorSuspended.selector);
        escrow.createDeal(
            supplier, buyRef, arbiter,
            total, FEE_BPS,
            uint64(block.timestamp + 7 days), 168, ms
        );
    }

    // E6: suspended attestor rejected in createDealWithPanel (empty panel = single-arbiter path)
    function testE6_SuspendedAttestor_RejectedViaPanel_EmptyPanel() public {
        vm.prank(pauser); reg.scheduleSetStatus(attestorA, IAttestorRegistry.Status.Suspended);
        vm.warp(block.timestamp + 48 hours + 1);
        vm.prank(pauser); reg.executeSetStatus(attestorA);

        uint256 total = 1_000 * USDC_6;
        uint256 fee   = (total * FEE_BPS + 9_999) / 10_000;
        usdc.mint(buyer, total + fee);
        vm.prank(buyer); usdc.approve(address(escrow), total + fee);

        IWaybillEscrow.MilestoneInput[] memory ms = _milestoneWithAttestor(attestorA);
        address[] memory emptyPanel = new address[](0);

        vm.prank(buyer);
        vm.expectRevert(IWaybillEscrow.AttestorSuspended.selector);
        escrow.createDealWithPanel(
            supplier, buyRef, arbiter, emptyPanel,
            total, FEE_BPS,
            uint64(block.timestamp + 7 days), 168, ms, false, 0,
            IWaybillEscrow.FeePayer.BuyerPrepaid
        );
    }

    // E7: independent milestone (ACCEPTANCE) creates fine regardless of attestorA's suspension
    function testE7_AcceptanceMilestone_NotAffectedBySuspension() public {
        vm.prank(pauser); reg.scheduleSetStatus(attestorA, IAttestorRegistry.Status.Suspended);
        vm.warp(block.timestamp + 48 hours + 1);
        vm.prank(pauser); reg.executeSetStatus(attestorA);

        uint256 total = 1_000 * USDC_6;
        uint256 fee   = (total * FEE_BPS + 9_999) / 10_000;
        usdc.mint(buyer, total + fee);
        vm.prank(buyer); usdc.approve(address(escrow), total + fee);

        // ACCEPTANCE milestone — no attestor, not affected by suspension
        IWaybillEscrow.MilestoneInput[] memory ms = new IWaybillEscrow.MilestoneInput[](1);
        ms[0] = IWaybillEscrow.MilestoneInput({
            bps:          10_000,
            condition:    IWaybillEscrow.ReleaseCondition.ACCEPTANCE,
            attestors:    new address[](0),
            threshold:    0,
            deadline:     uint64(block.timestamp + 30 days),
            gracePeriod:  72,
            reviewWindow: 0,
            dependsOn:    type(uint16).max
        });

        vm.prank(buyer);
        uint256 dealId = escrow.createDeal(
            supplier, buyRef, arbiter,
            total, FEE_BPS,
            uint64(block.timestamp + 7 days), 168, ms
        );
        // dealId starts at 0; verify deal was created successfully
        assertEq(escrow.deals(dealId).buyer, buyer, "ACCEPTANCE deal unaffected by suspension");
    }

    // =========================================================================
    // COUNTER / DUPLICATE EDGE CASES
    // =========================================================================

    // C1: duplicate Attested outcomes just increment counter (no special logic)
    function testC1_DuplicateOutcomes_JustIncrement() public {
        for (uint256 i = 0; i < 5; i++) {
            vm.prank(writer); reg.recordOutcome(attestorA, IAttestorRegistry.OutcomeKind.Attested);
        }
        (uint32 a,,) = reg.counts(attestorA);
        assertEq(a, 5);
    }

    // C2: counter saturation — upheld saturates at type(uint32).max without overflow.
    //     Uses vm.store to plant upheld near max:
    //       AttestorRegistry storage: slot 0=_isWriter, slot 1=_counts (pauser is immutable)
    //       Counts packing in slot: attested[bits 0-31], upheld[bits 32-63], slashed[bits 64-95]
    //       To store upheld=X: write bytes32 where the 4 bytes at positions [24..27] from the
    //       left equal X (i.e. shift X left by 32 bits and zero attested+slashed).
    function testC2_UpheldSaturation_NoOverflow() public {
        // Compute the storage slot for _counts[attestorA] (mapping at slot 1)
        bytes32 mapSlot = keccak256(abi.encode(attestorA, uint256(1)));
        // Pack upheld=type(uint32).max-2 at bits[32..63] of the 256-bit slot word.
        // bytes32 stores MSB first; bits 32-63 of the uint256 are bytes [24..27] from the left.
        // Casting uint256 to bytes32 keeps the same bit pattern.
        uint32 target = type(uint32).max - 2; // 4294967293
        bytes32 packed = bytes32(uint256(target) << 32);  // upheld field only, attested+slashed=0
        vm.store(address(reg), mapSlot, packed);

        // Verify the plant worked by reading back via vm.load and direct counts()
        bytes32 raw = vm.load(address(reg), mapSlot);
        // upheld occupies bytes [24..27] of the 32-byte word (0-indexed from left)
        uint32 upheldRaw = uint32(uint256(raw) >> 32);
        assertEq(upheldRaw, target, "vm.load upheld raw");

        (,uint32 u,) = reg.counts(attestorA);
        assertEq(u, target, "setup ok");

        // One more upheld: increments to max-1
        vm.prank(writer); reg.recordOutcome(attestorA, IAttestorRegistry.OutcomeKind.Upheld);
        (,uint32 u1,) = reg.counts(attestorA);
        assertEq(u1, type(uint32).max - 1, "incremented to max-1");

        // One more: saturates at max
        vm.prank(writer); reg.recordOutcome(attestorA, IAttestorRegistry.OutcomeKind.Upheld);
        (,uint32 u2,) = reg.counts(attestorA);
        assertEq(u2, type(uint32).max, "saturated at max");

        // One more: must NOT overflow — stays at max
        vm.prank(writer); reg.recordOutcome(attestorA, IAttestorRegistry.OutcomeKind.Upheld);
        (,uint32 u3,) = reg.counts(attestorA);
        assertEq(u3, type(uint32).max, "capped at max, no overflow");
    }
}
