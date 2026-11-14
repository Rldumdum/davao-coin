// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {DavaoCoin} from "../src/DavaoCoin.sol";
import {PuzzleRewards} from "../src/PuzzleRewards.sol";

contract PuzzleRewardsTest is Test {
    DavaoCoin internal token;
    PuzzleRewards internal rewards;
    address internal player = makeAddr("player");
    address internal copycat = makeAddr("copycat");

    function setUp() public {
        token = new DavaoCoin(address(this));
        rewards = new PuzzleRewards(token, address(this));
        token.transfer(address(rewards), 10_000e18);
        rewards.addPuzzle("King of fruits?", keccak256("durian"), 100e18);
    }

    function test_CorrectAnswerPaysReward() public {
        vm.prank(player);
        rewards.solve(0, "durian");

        assertEq(token.balanceOf(player), 100e18);
        assertTrue(rewards.hasSolved(0, player));
        assertEq(rewards.rewardPool(), 9_900e18);
    }

    function test_RevertWhen_WrongAnswer() public {
        vm.prank(player);
        vm.expectRevert(abi.encodeWithSelector(PuzzleRewards.WrongAnswer.selector, 0));
        rewards.solve(0, "mango");
    }

    function test_RevertWhen_SolvingTwice() public {
        vm.startPrank(player);
        rewards.solve(0, "durian");
        vm.expectRevert(abi.encodeWithSelector(PuzzleRewards.AlreadySolved.selector, 0, player));
        rewards.solve(0, "durian");
        vm.stopPrank();
    }

    function test_RevertWhen_PuzzleDoesNotExist() public {
        vm.prank(player);
        vm.expectRevert(abi.encodeWithSelector(PuzzleRewards.UnknownPuzzle.selector, 7));
        rewards.solve(7, "durian");
    }

    function test_RevertWhen_PuzzleDeactivated() public {
        rewards.deactivatePuzzle(0);

        vm.prank(player);
        vm.expectRevert(abi.encodeWithSelector(PuzzleRewards.PuzzleInactive.selector, 0));
        rewards.solve(0, "durian");
    }

    function test_RevertWhen_NonOwnerAddsPuzzle() public {
        vm.prank(player);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, player));
        rewards.addPuzzle("free money?", keccak256("yes"), 1_000e18);
    }

    /// Documents the known weakness: once an answer is on-chain, anyone can reuse it.
    /// This test PASSES today, which is the problem. The security milestone will make it fail.
    function test_KnownWeakness_AnswerCanBeCopied() public {
        vm.prank(player);
        rewards.solve(0, "durian");

        vm.prank(copycat);
        rewards.solve(0, "durian");
        assertEq(token.balanceOf(copycat), 100e18);
    }
}
