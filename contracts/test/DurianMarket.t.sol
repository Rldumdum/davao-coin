// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {DavaoCoin} from "../src/DavaoCoin.sol";
import {DurianMarket} from "../src/DurianMarket.sol";

/// A seller whose address refuses ETH, used to prove buyers can't be blocked.
contract EthRejectingSeller {
    function list(DavaoCoin token, DurianMarket market, uint256 amount, uint256 price) external {
        token.approve(address(market), amount);
        market.createOffer(amount, price);
    }

    receive() external payable {
        revert("no ETH please");
    }
}

contract DurianMarketTest is Test {
    DavaoCoin internal token;
    DurianMarket internal market;
    address internal seller = makeAddr("seller");
    address internal buyer = makeAddr("buyer");

    function setUp() public {
        token = new DavaoCoin(address(this));
        market = new DurianMarket(token);
        token.transfer(seller, 10_000e18);
        vm.deal(buyer, 10 ether);
    }

    function _list(uint256 amount, uint256 price) internal returns (uint256 offerId) {
        vm.startPrank(seller);
        token.approve(address(market), amount);
        offerId = market.createOffer(amount, price);
        vm.stopPrank();
    }

    function test_CreateOfferEscrowsTokens() public {
        _list(1_000e18, 0.05 ether);

        assertEq(token.balanceOf(address(market)), 1_000e18);
        assertEq(token.balanceOf(seller), 9_000e18);
        (address s, uint256 amount, uint256 price, bool active) = market.offers(0);
        assertEq(s, seller);
        assertEq(amount, 1_000e18);
        assertEq(price, 0.05 ether);
        assertTrue(active);
    }

    function test_BuyDeliversTokensAndCreditsSeller() public {
        uint256 id = _list(1_000e18, 0.05 ether);

        vm.prank(buyer);
        market.buy{value: 0.05 ether}(id);

        assertEq(token.balanceOf(buyer), 1_000e18);
        assertEq(market.proceeds(seller), 0.05 ether);
        (,,, bool active) = market.offers(id);
        assertFalse(active);
    }

    function test_SellerWithdrawsProceeds() public {
        uint256 id = _list(1_000e18, 0.05 ether);
        vm.prank(buyer);
        market.buy{value: 0.05 ether}(id);

        vm.prank(seller);
        market.withdrawProceeds();

        assertEq(seller.balance, 0.05 ether);
        assertEq(market.proceeds(seller), 0);
    }

    function test_RevertWhen_WrongPayment() public {
        uint256 id = _list(1_000e18, 0.05 ether);

        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(DurianMarket.WrongPayment.selector, 0.05 ether, 0.01 ether));
        market.buy{value: 0.01 ether}(id);
    }

    function test_RevertWhen_BuyingTwice() public {
        uint256 id = _list(1_000e18, 0.05 ether);
        vm.startPrank(buyer);
        market.buy{value: 0.05 ether}(id);
        vm.expectRevert(abi.encodeWithSelector(DurianMarket.OfferNotActive.selector, id));
        market.buy{value: 0.05 ether}(id);
        vm.stopPrank();
    }

    function test_RevertWhen_BuyingOwnOffer() public {
        uint256 id = _list(1_000e18, 0.05 ether);
        vm.deal(seller, 1 ether);

        vm.prank(seller);
        vm.expectRevert(abi.encodeWithSelector(DurianMarket.CannotBuyOwnOffer.selector, id));
        market.buy{value: 0.05 ether}(id);
    }

    function test_CancelReturnsTokens() public {
        uint256 id = _list(1_000e18, 0.05 ether);

        vm.prank(seller);
        market.cancelOffer(id);

        assertEq(token.balanceOf(seller), 10_000e18);
    }

    function test_RevertWhen_StrangerCancels() public {
        uint256 id = _list(1_000e18, 0.05 ether);

        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(DurianMarket.NotSeller.selector, id));
        market.cancelOffer(id);
    }

    function test_SellerRejectingEthCannotBlockBuyers() public {
        EthRejectingSeller stubborn = new EthRejectingSeller();
        token.transfer(address(stubborn), 500e18);
        stubborn.list(token, market, 500e18, 0.01 ether);

        vm.prank(buyer);
        market.buy{value: 0.01 ether}(0);

        assertEq(token.balanceOf(buyer), 500e18, "buyer still gets tokens");
        assertEq(market.proceeds(address(stubborn)), 0.01 ether);
    }
}
