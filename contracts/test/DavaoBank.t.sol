// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {DavaoCoin} from "../src/DavaoCoin.sol";
import {DavaoBank} from "../src/DavaoBank.sol";

contract DavaoBankTest is Test {
    DavaoCoin internal token;
    DavaoBank internal bank;
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    function setUp() public {
        token = new DavaoCoin(address(this));
        bank = new DavaoBank(token);
        token.transfer(alice, 1_000e18);
    }

    function _deposit(address who, uint256 amount) internal {
        vm.startPrank(who);
        token.approve(address(bank), amount);
        bank.deposit(amount);
        vm.stopPrank();
    }

    function test_DepositMovesTokensIntoBank() public {
        _deposit(alice, 400e18);

        assertEq(bank.balanceOf(alice), 400e18);
        assertEq(bank.totalDeposits(), 400e18);
        assertEq(token.balanceOf(alice), 600e18);
        assertEq(token.balanceOf(address(bank)), 400e18);
    }

    function test_RevertWhen_DepositWithoutApproval() public {
        vm.prank(alice);
        vm.expectRevert(); // ERC20InsufficientAllowance from the token
        bank.deposit(1e18);
    }

    function test_RevertWhen_DepositZero() public {
        vm.prank(alice);
        vm.expectRevert(DavaoBank.ZeroAmount.selector);
        bank.deposit(0);
    }

    function test_WithdrawReturnsTokens() public {
        _deposit(alice, 400e18);

        vm.prank(alice);
        bank.withdraw(150e18);

        assertEq(bank.balanceOf(alice), 250e18);
        assertEq(token.balanceOf(alice), 750e18);
    }

    function test_RevertWhen_WithdrawMoreThanBalance() public {
        _deposit(alice, 100e18);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(DavaoBank.InsufficientBankBalance.selector, 100e18, 101e18));
        bank.withdraw(101e18);
    }

    function test_TransferMovesLedgerBalanceOnly() public {
        _deposit(alice, 300e18);

        vm.prank(alice);
        bank.transfer(bob, 120e18);

        assertEq(bank.balanceOf(alice), 180e18);
        assertEq(bank.balanceOf(bob), 120e18);
        assertEq(token.balanceOf(address(bank)), 300e18, "no tokens should leave the bank");

        vm.prank(bob);
        bank.withdraw(120e18);
        assertEq(token.balanceOf(bob), 120e18);
    }

    function test_RevertWhen_TransferToSelfOrZero() public {
        _deposit(alice, 10e18);

        vm.startPrank(alice);
        vm.expectRevert(DavaoBank.InvalidRecipient.selector);
        bank.transfer(alice, 1e18);
        vm.expectRevert(DavaoBank.InvalidRecipient.selector);
        bank.transfer(address(0), 1e18);
        vm.stopPrank();
    }

    /// The ledger must always match the tokens the bank actually holds.
    function testFuzz_LedgerMatchesHoldings(uint256 depositAmount, uint256 sendAmount, uint256 withdrawAmount) public {
        depositAmount = bound(depositAmount, 1, 1_000e18);
        sendAmount = bound(sendAmount, 1, depositAmount);
        withdrawAmount = bound(withdrawAmount, 0, depositAmount - sendAmount);

        _deposit(alice, depositAmount);
        vm.prank(alice);
        bank.transfer(bob, sendAmount);
        if (withdrawAmount > 0) {
            vm.prank(alice);
            bank.withdraw(withdrawAmount);
        }

        assertEq(bank.balanceOf(alice) + bank.balanceOf(bob), bank.totalDeposits());
        assertEq(bank.totalDeposits(), token.balanceOf(address(bank)));
    }
}
