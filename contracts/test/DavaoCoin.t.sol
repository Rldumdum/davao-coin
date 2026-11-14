// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {DavaoCoin} from "../src/DavaoCoin.sol";

contract DavaoCoinTest is Test {
    uint256 internal constant ONE_BILLION_TOKENS = 1_000_000_000 * 1e18;

    IERC20Metadata internal token;
    address internal treasury = makeAddr("treasury");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    function setUp() public {
        // Talk to the contract only through the standard ERC-20 interface,
        // exactly as wallets and exchanges will.
        token = IERC20Metadata(address(new DavaoCoin(treasury)));
    }

    /* ---------------------------------------------------------------- metadata */

    function test_Name() public view {
        assertEq(token.name(), "Davao Coin");
    }

    function test_Symbol() public view {
        assertEq(token.symbol(), "DURIAN");
    }

    function test_Decimals() public view {
        assertEq(token.decimals(), 18);
    }

    /* ------------------------------------------------------------------ supply */

    function test_TotalSupplyIsOneBillionTokens() public view {
        assertEq(token.totalSupply(), ONE_BILLION_TOKENS);
    }

    function test_InitialHolderReceivesEntireSupply() public view {
        assertEq(token.balanceOf(treasury), ONE_BILLION_TOKENS);
    }

    function test_RevertWhen_InitialHolderIsZeroAddress() public {
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InvalidReceiver.selector, address(0)));
        new DavaoCoin(address(0));
    }

    /* --------------------------------------------------------------- transfers */

    function test_TransferMovesTokens() public {
        vm.prank(treasury);
        bool ok = token.transfer(alice, 100e18);

        assertTrue(ok);
        assertEq(token.balanceOf(alice), 100e18);
        assertEq(token.balanceOf(treasury), ONE_BILLION_TOKENS - 100e18);
    }

    function test_TransferEmitsTransferEvent() public {
        vm.expectEmit(true, true, false, true, address(token));
        emit IERC20.Transfer(treasury, alice, 100e18);

        vm.prank(treasury);
        token.transfer(alice, 100e18);
    }

    function test_RevertWhen_TransferExceedsBalance() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, alice, 0, 1));
        token.transfer(bob, 1);
    }

    /* -------------------------------------------------------------- allowances */

    function test_ApproveThenTransferFrom() public {
        vm.prank(treasury);
        token.approve(alice, 50e18);

        vm.prank(alice);
        token.transferFrom(treasury, bob, 30e18);

        assertEq(token.balanceOf(bob), 30e18);
        assertEq(token.allowance(treasury, alice), 20e18);
    }

    function test_RevertWhen_TransferFromExceedsAllowance() public {
        vm.prank(treasury);
        token.approve(alice, 10e18);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, alice, 10e18, 11e18));
        token.transferFrom(treasury, bob, 11e18);
    }

    /* -------------------------------------------------------------------- fuzz */

    /// Foundry runs this 1000 times with random `to` and `amount` values.
    function testFuzz_TransferNeverCreatesOrDestroysTokens(address to, uint256 amount) public {
        vm.assume(to != address(0) && to != treasury);
        amount = bound(amount, 0, ONE_BILLION_TOKENS);

        vm.prank(treasury);
        token.transfer(to, amount);

        assertEq(token.balanceOf(to) + token.balanceOf(treasury), ONE_BILLION_TOKENS);
        assertEq(token.totalSupply(), ONE_BILLION_TOKENS);
    }
}
