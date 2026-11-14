// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title PuzzleRewards
/// @notice Solve a puzzle, earn DURIAN. Each address can claim each puzzle once.
/// @dev The contract stores only keccak256(answer), never the answer itself.
///
///      KNOWN WEAKNESS (kept on purpose for the security milestone): `solve` sends the
///      plain-text answer in the transaction. Anyone watching pending transactions can copy
///      it and claim the same puzzle, and after the first solve the answer is public forever.
///      We'll fix this later with a commit-reveal scheme or server-signed vouchers.
contract PuzzleRewards is Ownable {
    using SafeERC20 for IERC20;

    struct Puzzle {
        string question;
        bytes32 answerHash;
        uint256 reward;
        bool active;
    }

    IERC20 public immutable token;
    Puzzle[] public puzzles;
    mapping(uint256 puzzleId => mapping(address solver => bool)) public hasSolved;

    event PuzzleAdded(uint256 indexed puzzleId, uint256 reward);
    event PuzzleDeactivated(uint256 indexed puzzleId);
    event PuzzleSolved(uint256 indexed puzzleId, address indexed solver, uint256 reward);

    error UnknownPuzzle(uint256 puzzleId);
    error PuzzleInactive(uint256 puzzleId);
    error AlreadySolved(uint256 puzzleId, address solver);
    error WrongAnswer(uint256 puzzleId);

    constructor(IERC20 token_, address initialOwner) Ownable(initialOwner) {
        token = token_;
    }

    function addPuzzle(string calldata question, bytes32 answerHash, uint256 reward)
        external
        onlyOwner
        returns (uint256 puzzleId)
    {
        puzzleId = puzzles.length;
        puzzles.push(Puzzle({question: question, answerHash: answerHash, reward: reward, active: true}));
        emit PuzzleAdded(puzzleId, reward);
    }

    function deactivatePuzzle(uint256 puzzleId) external onlyOwner {
        if (puzzleId >= puzzles.length) revert UnknownPuzzle(puzzleId);
        puzzles[puzzleId].active = false;
        emit PuzzleDeactivated(puzzleId);
    }

    /// @notice Submit an answer. Answers are compared exactly, so the UI normalizes
    ///         them (trim + lowercase) before sending.
    function solve(uint256 puzzleId, string calldata answer) external {
        if (puzzleId >= puzzles.length) revert UnknownPuzzle(puzzleId);
        Puzzle storage puzzle = puzzles[puzzleId];
        if (!puzzle.active) revert PuzzleInactive(puzzleId);
        if (hasSolved[puzzleId][msg.sender]) revert AlreadySolved(puzzleId, msg.sender);
        if (keccak256(bytes(answer)) != puzzle.answerHash) revert WrongAnswer(puzzleId);

        hasSolved[puzzleId][msg.sender] = true;
        emit PuzzleSolved(puzzleId, msg.sender, puzzle.reward);

        token.safeTransfer(msg.sender, puzzle.reward);
    }

    function puzzleCount() external view returns (uint256) {
        return puzzles.length;
    }

    /// @notice Tokens still available to pay out rewards.
    function rewardPool() external view returns (uint256) {
        return token.balanceOf(address(this));
    }
}
