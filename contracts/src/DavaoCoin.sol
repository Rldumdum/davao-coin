// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title Davao Coin (DURIAN)
/// @notice Fixed-supply ERC-20. Every token that will ever exist is minted once, in the constructor.
/// @dev `_mint` is `internal`, so only code inside this contract can call it, and the only
///      place this contract calls it is the constructor, which runs exactly once at deployment.
contract DavaoCoin is ERC20 {
    uint256 public constant TOTAL_SUPPLY = 1_000_000_000 * 1e18;

    constructor(address initialHolder) ERC20("Davao Coin", "DURIAN") {
        _mint(initialHolder, TOTAL_SUPPLY);
    }
}
