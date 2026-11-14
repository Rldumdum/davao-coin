// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {ERC1155Burnable} from "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Burnable.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title DavaoItems
/// @notice Every in-game item in Barangay Durian: ores you mine, fruit you eat, pickaxes you swing.
/// @dev ERC-1155 = many token types in one contract. Each id is its own fungible stack
///      (you hold "7 Copper Ore", not 7 separate NFTs), and one call can move a whole bundle
///      of different ids, which is what makes multi-item trades a single transaction.
///
///      Only MINTER_ROLE can create items (the mine, plus the deployer for stocking merchants).
///      Anyone can burn their own items (ERC1155Burnable): that's how eating fruit works.
contract DavaoItems is ERC1155, ERC1155Burnable, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    // Ores (from the mine)
    uint256 public constant COPPER_ORE = 1;
    uint256 public constant SILVER_ORE = 2;
    uint256 public constant GOLD_NUGGET = 3;
    uint256 public constant APO_CRYSTAL = 4;
    // Fruit (sold by merchants; eaten for stamina)
    uint256 public constant DURIAN_FRUIT = 10;
    uint256 public constant POMELO = 11;
    uint256 public constant MANGOSTEEN = 12;
    // Tools (held, not equipped: owning one is enough for the mine to apply its bonus)
    uint256 public constant IRON_PICKAXE = 20;
    uint256 public constant GOLD_PICKAXE = 21;

    constructor(address admin) ERC1155("") {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MINTER_ROLE, admin);
    }

    function mint(address to, uint256 id, uint256 amount) external onlyRole(MINTER_ROLE) {
        _mint(to, id, amount, "");
    }

    function mintBatch(address to, uint256[] calldata ids, uint256[] calldata amounts) external onlyRole(MINTER_ROLE) {
        _mintBatch(to, ids, amounts, "");
    }

    /// @dev Both ERC1155 and AccessControl implement ERC-165, so Solidity makes us say which wins.
    function supportsInterface(bytes4 interfaceId) public view override(ERC1155, AccessControl) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
