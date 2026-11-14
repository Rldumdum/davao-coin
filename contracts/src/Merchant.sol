// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {ERC1155Holder} from "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {DavaoItems} from "./DavaoItems.sol";

/// @title Merchant
/// @notice An NPC trader that lives entirely on-chain. You put a bundle on the table (DURIAN, ETH,
///         items), ask for a bundle back, and the merchant accepts if what you give is worth at
///         least what you take. Both sides move in one transaction: an atomic swap, so neither
///         side can walk away halfway.
/// @dev Everything is valued in DURIAN base units. DURIAN is worth exactly itself. Each item and
///      ETH have two prices: `buy` (what the merchant credits you when you give it) and `sell`
///      (what it charges when you take it). buy <= sell is enforced, otherwise you could buy and
///      sell back the same thing in a loop and drain the merchant.
contract Merchant is Ownable, ReentrancyGuardTransient, ERC1155Holder {
    using SafeERC20 for IERC20;

    /// @notice One side of a trade.
    struct Bundle {
        uint256 durian; // DURIAN base units
        uint256 eth; // wei
        uint256[] ids; // DavaoItems ids (duplicates allowed, they just add up)
        uint256[] amounts;
    }

    struct Price {
        uint128 buy; // credited per unit you give; 0 = merchant won't take it
        uint128 sell; // charged per unit you take; 0 = merchant won't part with it
    }

    IERC20 public immutable token;
    DavaoItems public immutable items;
    string public name;

    mapping(uint256 itemId => Price) public itemPrice;
    /// @notice DURIAN value of 1 ETH, as credited (buy) and as charged (sell).
    Price public ethRate;
    uint256[] internal _catalog;
    mapping(uint256 itemId => bool) internal _inCatalog;

    event PriceSet(uint256 indexed itemId, uint128 buy, uint128 sell);
    event EthRateSet(uint128 buy, uint128 sell);
    event Traded(address indexed trader, uint256 giveValue, uint256 takeValue);

    error EmptyTrade();
    error LengthMismatch();
    error ZeroItemAmount(uint256 itemId);
    error BuyAboveSell();
    error NotBuying(uint256 itemId);
    error NotSelling(uint256 itemId);
    error NotBuyingEth();
    error NotSellingEth();
    error WrongPayment(uint256 expectedWei, uint256 sentWei);
    error UnfairTrade(uint256 giveValue, uint256 takeValue);
    error OutOfEth(uint256 available, uint256 requested);
    error EthTransferFailed();

    constructor(IERC20 token_, DavaoItems items_, string memory name_, address initialOwner) Ownable(initialOwner) {
        token = token_;
        items = items_;
        name = name_;
    }

    /* ------------------------------------------------------------ owner setup */

    function setItemPrice(uint256 itemId, uint128 buy, uint128 sell) external onlyOwner {
        if (sell != 0 && buy > sell) revert BuyAboveSell();
        itemPrice[itemId] = Price(buy, sell);
        if (!_inCatalog[itemId]) {
            _inCatalog[itemId] = true;
            _catalog.push(itemId);
        }
        emit PriceSet(itemId, buy, sell);
    }

    function setEthRate(uint128 buy, uint128 sell) external onlyOwner {
        if (sell != 0 && buy > sell) revert BuyAboveSell();
        ethRate = Price(buy, sell);
        emit EthRateSet(buy, sell);
    }

    /// @notice Give the merchant ETH to pay out. (Its DURIAN and items arrive as plain transfers.)
    function stockEth() external payable onlyOwner {}

    /* ------------------------------------------------------------------ views */

    /// @notice Every item id this merchant has a price for, so the UI can list its stall.
    function catalog() external view returns (uint256[] memory) {
        return _catalog;
    }

    /// @notice What the merchant thinks each side is worth. The trade goes through iff giveValue >= takeValue.
    /// @dev Rounding always favors the merchant: ETH you give rounds down, ETH you take rounds up.
    ///      Without that, a 1-wei trade could be worth 0 and be "fair" for free.
    function quote(Bundle calldata give, Bundle calldata take)
        public
        view
        returns (uint256 giveValue, uint256 takeValue)
    {
        giveValue = give.durian;
        if (give.eth > 0) {
            if (ethRate.buy == 0) revert NotBuyingEth();
            giveValue += Math.mulDiv(give.eth, ethRate.buy, 1 ether, Math.Rounding.Floor);
        }
        giveValue += _itemsValue(give, true);

        takeValue = take.durian;
        if (take.eth > 0) {
            if (ethRate.sell == 0) revert NotSellingEth();
            takeValue += Math.mulDiv(take.eth, ethRate.sell, 1 ether, Math.Rounding.Ceil);
        }
        takeValue += _itemsValue(take, false);
    }

    /* ------------------------------------------------------------------ trade */

    /// @notice Swap `give` (from you) for `take` (from the merchant), all or nothing.
    /// @dev Before calling: approve this contract for `give.durian` on the token, and
    ///      `setApprovalForAll(merchant, true)` on DavaoItems if you're giving items.
    ///      Send exactly `give.eth` as msg.value.
    function trade(Bundle calldata give, Bundle calldata take) external payable nonReentrant {
        if (_isEmpty(give) && _isEmpty(take)) revert EmptyTrade();
        if (msg.value != give.eth) revert WrongPayment(give.eth, msg.value);

        (uint256 giveValue, uint256 takeValue) = quote(give, take);
        if (giveValue < takeValue) revert UnfairTrade(giveValue, takeValue);
        // msg.value is already in our balance here, so ETH you give can pay for ETH you take.
        if (take.eth > address(this).balance) revert OutOfEth(address(this).balance, take.eth);

        emit Traded(msg.sender, giveValue, takeValue);

        // Pull everything in first, then pay out. Any failed transfer reverts the whole swap.
        if (give.durian > 0) token.safeTransferFrom(msg.sender, address(this), give.durian);
        if (give.ids.length > 0) items.safeBatchTransferFrom(msg.sender, address(this), give.ids, give.amounts, "");

        if (take.durian > 0) token.safeTransfer(msg.sender, take.durian);
        if (take.ids.length > 0) items.safeBatchTransferFrom(address(this), msg.sender, take.ids, take.amounts, "");
        if (take.eth > 0) {
            (bool ok,) = msg.sender.call{value: take.eth}("");
            if (!ok) revert EthTransferFailed();
        }
    }

    /* --------------------------------------------------------------- internal */

    function _itemsValue(Bundle calldata bundle, bool giving) private view returns (uint256 value) {
        if (bundle.ids.length != bundle.amounts.length) revert LengthMismatch();
        for (uint256 i = 0; i < bundle.ids.length; i++) {
            uint256 id = bundle.ids[i];
            if (bundle.amounts[i] == 0) revert ZeroItemAmount(id);
            Price memory p = itemPrice[id];
            uint256 unit = giving ? p.buy : p.sell;
            if (unit == 0) {
                if (giving) revert NotBuying(id);
                revert NotSelling(id);
            }
            value += unit * bundle.amounts[i];
        }
    }

    function _isEmpty(Bundle calldata b) private pure returns (bool) {
        return b.durian == 0 && b.eth == 0 && b.ids.length == 0;
    }
}
