// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {DavaoCoin} from "../src/DavaoCoin.sol";
import {DavaoItems} from "../src/DavaoItems.sol";
import {Merchant} from "../src/Merchant.sol";

/// A trader contract that tries to call back into the merchant while receiving items.
contract ReentrantTrader {
    Merchant internal merchant;
    bool internal attacked;

    constructor(Merchant merchant_) {
        merchant = merchant_;
    }

    function go(Merchant.Bundle calldata give, Merchant.Bundle calldata take) external payable {
        merchant.trade{value: msg.value}(give, take);
    }

    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata)
        external
        returns (bytes4)
    {
        if (!attacked) {
            attacked = true;
            Merchant.Bundle memory empty;
            Merchant.Bundle memory one;
            one.durian = 1;
            merchant.trade(empty, one); // must revert: nonReentrant
        }
        return this.onERC1155BatchReceived.selector;
    }

    receive() external payable {}
}

contract MerchantTest is Test {
    DavaoCoin internal token;
    DavaoItems internal items;
    Merchant internal smith;
    address internal player = makeAddr("player");

    uint256 internal COPPER;
    uint256 internal GOLD;
    uint256 internal PICK;
    uint256 internal FRUIT;

    function setUp() public {
        token = new DavaoCoin(address(this));
        items = new DavaoItems(address(this));
        smith = new Merchant(token, items, "Mang Berto", address(this));
        COPPER = items.COPPER_ORE();
        GOLD = items.GOLD_NUGGET();
        PICK = items.IRON_PICKAXE();
        FRUIT = items.DURIAN_FRUIT();

        smith.setItemPrice(COPPER, 15e18, 25e18); // buys and sells copper
        smith.setItemPrice(GOLD, 100e18, 0); // buys gold, won't sell it
        smith.setItemPrice(PICK, 200e18, 400e18);
        smith.setEthRate(90_000e18, 110_000e18);

        token.transfer(address(smith), 100_000e18);
        items.mint(address(smith), PICK, 5);
        items.mint(address(smith), COPPER, 50);
        smith.stockEth{value: 10 ether}();

        token.transfer(player, 1_000e18);
        items.mint(player, COPPER, 20);
        items.mint(player, GOLD, 2);
        items.mint(player, FRUIT, 1);
        vm.deal(player, 5 ether);

        vm.startPrank(player);
        token.approve(address(smith), type(uint256).max);
        items.setApprovalForAll(address(smith), true);
        vm.stopPrank();
    }

    /* ------------------------------------------------------------- helpers */

    function _bundle(uint256 durian, uint256 eth) internal pure returns (Merchant.Bundle memory b) {
        b.durian = durian;
        b.eth = eth;
    }

    function _items(uint256 id, uint256 amount) internal pure returns (Merchant.Bundle memory b) {
        b.ids = new uint256[](1);
        b.amounts = new uint256[](1);
        b.ids[0] = id;
        b.amounts[0] = amount;
    }

    /* --------------------------------------------------------------- tests */

    function test_SellOresForDurian() public {
        // 20 copper @ 15 + 2 gold @ 100 = 500 DURIAN
        Merchant.Bundle memory give;
        give.ids = new uint256[](2);
        give.amounts = new uint256[](2);
        (give.ids[0], give.amounts[0]) = (COPPER, 20);
        (give.ids[1], give.amounts[1]) = (GOLD, 2);

        vm.prank(player);
        smith.trade(give, _bundle(500e18, 0));

        assertEq(token.balanceOf(player), 1_500e18);
        assertEq(items.balanceOf(player, COPPER), 0);
        assertEq(items.balanceOf(address(smith), GOLD), 2);
    }

    function test_MixedBundleBothWays() public {
        // Give 10 copper (150) + 250 DURIAN = 400; take a pickaxe (400).
        Merchant.Bundle memory give = _items(COPPER, 10);
        give.durian = 250e18;

        vm.prank(player);
        smith.trade(give, _items(PICK, 1));

        assertEq(items.balanceOf(player, PICK), 1);
        assertEq(items.balanceOf(player, COPPER), 10);
        assertEq(token.balanceOf(player), 750e18);
    }

    function test_RejectsUnfairTrade() public {
        vm.prank(player);
        vm.expectRevert(abi.encodeWithSelector(Merchant.UnfairTrade.selector, 399e18, 400e18));
        smith.trade(_bundle(399e18, 0), _items(PICK, 1));
    }

    function test_EthForDurianAtTheSpread() public {
        // Giving 0.01 ETH is credited at 90k/ETH = 900 DURIAN.
        vm.prank(player);
        smith.trade{value: 0.01 ether}(_bundle(0, 0.01 ether), _bundle(900e18, 0));
        assertEq(token.balanceOf(player), 1_900e18);

        // Taking 0.01 ETH costs 110k/ETH = 1,100 DURIAN.
        vm.prank(player);
        smith.trade(_bundle(1_100e18, 0), _bundle(0, 0.01 ether));
        assertEq(token.balanceOf(player), 800e18);
        assertEq(player.balance, 5 ether);
    }

    function test_RoundingFavorsTheMerchant() public {
        // A tiny rate makes the fractions visible: 1 and 3 DURIAN-wei per whole ETH.
        smith.setEthRate(1, 3);

        // Giving 0.1 ETH is worth 0.1 DURIAN-wei, rounded down to 0: it can't buy anything.
        vm.prank(player);
        vm.expectRevert(abi.encodeWithSelector(Merchant.UnfairTrade.selector, 0, 1));
        smith.trade{value: 0.1 ether}(_bundle(0, 0.1 ether), _bundle(1, 0));

        // Taking 0.1 ETH costs 0.3 DURIAN-wei, rounded up to 1: never free.
        (, uint256 takeValue) = smith.quote(_bundle(0, 0), _bundle(0, 0.1 ether));
        assertEq(takeValue, 1);
    }

    function test_RefusesItemsItDoesNotTrade() public {
        vm.startPrank(player);
        vm.expectRevert(abi.encodeWithSelector(Merchant.NotBuying.selector, FRUIT));
        smith.trade(_items(FRUIT, 1), _bundle(1e18, 0));

        vm.expectRevert(abi.encodeWithSelector(Merchant.NotSelling.selector, GOLD));
        smith.trade(_bundle(1_000e18, 0), _items(GOLD, 1));
        vm.stopPrank();
    }

    function test_RequiresExactEth() public {
        vm.prank(player);
        vm.expectRevert(abi.encodeWithSelector(Merchant.WrongPayment.selector, 0.01 ether, 0.02 ether));
        smith.trade{value: 0.02 ether}(_bundle(0, 0.01 ether), _bundle(1, 0));
    }

    function test_RevertsWhenMerchantIsOutOfStock() public {
        // A fair price for 11 ETH (1.21M DURIAN), but the merchant only holds 10.
        token.transfer(player, 1_210_000e18);
        vm.prank(player);
        vm.expectRevert(abi.encodeWithSelector(Merchant.OutOfEth.selector, 10 ether, 11 ether));
        smith.trade(_bundle(1_210_000e18, 0), _bundle(0, 11 ether));

        // Items: the ERC-1155 balance check reverts the whole swap, and the player keeps their DURIAN.
        vm.prank(player);
        vm.expectRevert();
        smith.trade(_bundle(2_400e18, 0), _items(PICK, 6));
        assertEq(token.balanceOf(player), 1_211_000e18);
    }

    function test_RejectsEmptyTradeAndBadArrays() public {
        Merchant.Bundle memory empty;
        vm.prank(player);
        vm.expectRevert(Merchant.EmptyTrade.selector);
        smith.trade(empty, empty);

        Merchant.Bundle memory bad = _items(COPPER, 1);
        bad.amounts = new uint256[](0);
        vm.prank(player);
        vm.expectRevert(Merchant.LengthMismatch.selector);
        smith.trade(bad, empty);

        vm.prank(player);
        vm.expectRevert(abi.encodeWithSelector(Merchant.ZeroItemAmount.selector, COPPER));
        smith.trade(_items(COPPER, 0), _bundle(0, 0));
    }

    function test_BuyAboveSellIsRejected() public {
        vm.expectRevert(Merchant.BuyAboveSell.selector);
        smith.setItemPrice(COPPER, 30e18, 20e18);
        vm.expectRevert(Merchant.BuyAboveSell.selector);
        smith.setEthRate(2, 1);
    }

    function test_CatalogListsEachItemOnce() public {
        smith.setItemPrice(COPPER, 10e18, 20e18); // re-pricing doesn't duplicate
        uint256[] memory ids = smith.catalog();
        assertEq(ids.length, 3);
        assertEq(ids[0], COPPER);
        assertEq(ids[1], GOLD);
        assertEq(ids[2], PICK);
    }

    function test_ReentrancyIsBlocked() public {
        ReentrantTrader attacker = new ReentrantTrader(smith);
        token.transfer(address(attacker), 1_000e18);
        vm.prank(address(attacker));
        token.approve(address(smith), type(uint256).max);

        vm.expectRevert(); // the inner trade hits ReentrancyGuardReentrantCall, bubbling up
        attacker.go(_bundle(400e18, 0), _items(PICK, 1));
    }

    /// Buying and immediately selling back never makes the player richer (buy <= sell).
    function testFuzz_NoRoundTripProfit(uint8 qty) public {
        vm.assume(qty > 0 && qty <= 2);
        uint256 cost = uint256(qty) * 400e18;
        token.transfer(player, cost);
        uint256 before = token.balanceOf(player);

        vm.startPrank(player);
        smith.trade(_bundle(cost, 0), _items(PICK, qty));
        smith.trade(_items(PICK, qty), _bundle(uint256(qty) * 200e18, 0));
        vm.stopPrank();

        assertLe(token.balanceOf(player), before);
    }

    /// Any DURIAN-for-copper trade is accepted exactly when the price covers it.
    function testFuzz_FairnessBoundary(uint256 durian, uint8 qty) public {
        qty = uint8(bound(qty, 1, 40));
        durian = bound(durian, 0, 1_000e18);
        bool fair = durian >= uint256(qty) * 25e18;

        vm.prank(player);
        if (!fair) vm.expectRevert();
        smith.trade(_bundle(durian, 0), _items(COPPER, qty));
        if (fair) assertEq(items.balanceOf(player, COPPER), 20 + uint256(qty));
    }
}
