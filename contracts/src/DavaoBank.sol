// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

/// @title DavaoBank
/// @notice A minimal bank for DURIAN: deposit from your wallet, withdraw back to it,
///         and move money between bank accounts without touching the token contract.
/// @dev The bank holds the real tokens; `balanceOf` is its internal ledger of who owns them.
///      Invariant: sum(balanceOf) == totalDeposits == token.balanceOf(address(this)).
contract DavaoBank is ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;

    mapping(address account => uint256 balance) public balanceOf;
    uint256 public totalDeposits;

    event Deposited(address indexed account, uint256 amount);
    event Withdrawn(address indexed account, uint256 amount);
    event Transferred(address indexed from, address indexed to, uint256 amount);

    error ZeroAmount();
    error InvalidRecipient();
    error InsufficientBankBalance(uint256 available, uint256 requested);

    constructor(IERC20 token_) {
        token = token_;
    }

    /// @notice Move `amount` DURIAN from your wallet into the bank.
    /// @dev Caller must first `approve` this contract on the token for at least `amount`.
    function deposit(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();

        balanceOf[msg.sender] += amount;
        totalDeposits += amount;
        emit Deposited(msg.sender, amount);

        token.safeTransferFrom(msg.sender, address(this), amount);
    }

    /// @notice Move `amount` DURIAN from the bank back to your wallet.
    function withdraw(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        uint256 available = balanceOf[msg.sender];
        if (amount > available) revert InsufficientBankBalance(available, amount);

        // Checks-Effects-Interactions: update the ledger before sending tokens out.
        balanceOf[msg.sender] = available - amount;
        totalDeposits -= amount;
        emit Withdrawn(msg.sender, amount);

        token.safeTransfer(msg.sender, amount);
    }

    /// @notice Send `amount` from your bank account to `to`'s bank account. No tokens move.
    function transfer(address to, uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        if (to == address(0) || to == msg.sender) revert InvalidRecipient();
        uint256 available = balanceOf[msg.sender];
        if (amount > available) revert InsufficientBankBalance(available, amount);

        balanceOf[msg.sender] = available - amount;
        balanceOf[to] += amount;
        emit Transferred(msg.sender, to, amount);
    }
}
