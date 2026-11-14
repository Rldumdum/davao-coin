// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {DavaoCoin} from "../src/DavaoCoin.sol";
import {DavaoItems} from "../src/DavaoItems.sol";
import {DurianMine} from "../src/DurianMine.sol";

contract DurianMineTest is Test {
    DavaoCoin internal token;
    DavaoItems internal items;
    DurianMine internal mine;
    address internal miner = makeAddr("miner");
    uint256 internal signerKey = 0xA11CE;
    uint256 internal nextVoucherId = 1;

    uint256 internal copperSpot;
    uint256 internal goldSpot;

    function setUp() public {
        vm.warp(1_700_000_000);
        token = new DavaoCoin(address(this));
        items = new DavaoItems(address(this));
        mine = new DurianMine(token, items, address(this), vm.addr(signerKey));
        items.grantRole(items.MINTER_ROLE(), address(mine));
        token.transfer(address(mine), 1_000_000e18);

        copperSpot = mine.addSpot(items.COPPER_ORE(), 1, 10e18, 8);
        goldSpot = mine.addSpot(items.GOLD_NUGGET(), 1, 60e18, 45);
    }

    /* ---------------------------------------------------------- helpers */

    struct Voucher {
        uint256 id;
        uint256 deadline;
        bytes sig;
    }

    function _voucher(DurianMine m, address who, uint256 spot, uint256 key) internal returns (Voucher memory v) {
        v.id = nextVoucherId++;
        v.deadline = block.timestamp + 120;
        (uint8 vv, bytes32 r, bytes32 s) = vm.sign(key, m.voucherDigest(who, spot, v.id, v.deadline));
        v.sig = abi.encodePacked(r, s, vv);
    }

    /// Server signs a voucher, then `who` uses it.
    function _mine(DurianMine m, address who, uint256 spot) internal {
        Voucher memory v = _voucher(m, who, spot, signerKey);
        vm.prank(who);
        m.mine(spot, v.id, v.deadline, v.sig);
    }

    function _mine(address who, uint256 spot) internal {
        _mine(mine, who, spot);
    }

    /* ------------------------------------------------------------ tests */

    function test_MinePaysDurianAndMintsOre() public {
        _mine(miner, copperSpot);

        assertEq(token.balanceOf(miner), 10e18);
        assertEq(items.balanceOf(miner, items.COPPER_ORE()), 1);
        assertEq(mine.timesMined(miner), 1);
        assertEq(mine.nextMineAt(copperSpot, miner), block.timestamp + 8);
    }

    function test_CooldownBlocksUntilReady() public {
        _mine(miner, copperSpot);

        // Even with a fresh, valid voucher the on-chain cooldown still applies.
        uint256 readyAt = block.timestamp + 8;
        Voucher memory v = _voucher(mine, miner, copperSpot, signerKey);
        vm.prank(miner);
        vm.expectRevert(abi.encodeWithSelector(DurianMine.StillCoolingDown.selector, copperSpot, readyAt));
        mine.mine(copperSpot, v.id, v.deadline, v.sig);

        vm.warp(readyAt);
        _mine(miner, copperSpot);

        assertEq(items.balanceOf(miner, items.COPPER_ORE()), 2);
    }

    function test_CooldownIsPerSpotAndPerPlayer() public {
        _mine(miner, copperSpot);

        // Same player, different spot: fine.
        _mine(miner, goldSpot);

        // Different player, same spot: fine.
        address other = makeAddr("other");
        _mine(other, copperSpot);

        assertEq(mine.timesMined(miner), 2);
        assertEq(mine.timesMined(other), 1);
    }

    function test_PickaxesMultiplyYield() public {
        items.mint(miner, items.IRON_PICKAXE(), 1);
        assertEq(mine.pickaxeBonus(miner), 2);

        _mine(miner, goldSpot);
        assertEq(token.balanceOf(miner), 120e18);
        assertEq(items.balanceOf(miner, items.GOLD_NUGGET()), 2);

        // The best pickaxe wins; they don't stack.
        items.mint(miner, items.GOLD_PICKAXE(), 1);
        assertEq(mine.pickaxeBonus(miner), 3);
        _mine(miner, copperSpot);
        assertEq(token.balanceOf(miner), 150e18);
        assertEq(items.balanceOf(miner, items.COPPER_ORE()), 3);
    }

    function test_RevertsWhenPoolIsEmpty() public {
        DurianMine broke = new DurianMine(token, items, address(this), vm.addr(signerKey));
        items.grantRole(items.MINTER_ROLE(), address(broke));
        uint256 spot = broke.addSpot(items.COPPER_ORE(), 1, 10e18, 8);

        Voucher memory v = _voucher(broke, miner, spot, signerKey);
        vm.prank(miner);
        vm.expectRevert(abi.encodeWithSelector(DurianMine.MinePoolEmpty.selector, 0, 10e18));
        broke.mine(spot, v.id, v.deadline, v.sig);
    }

    function test_RevertsOnUnknownAndInactiveSpots() public {
        Voucher memory v = _voucher(mine, miner, 99, signerKey);
        vm.prank(miner);
        vm.expectRevert(abi.encodeWithSelector(DurianMine.UnknownSpot.selector, 99));
        mine.mine(99, v.id, v.deadline, v.sig);

        mine.setSpotActive(copperSpot, false);
        v = _voucher(mine, miner, copperSpot, signerKey);
        vm.prank(miner);
        vm.expectRevert(abi.encodeWithSelector(DurianMine.SpotInactive.selector, copperSpot));
        mine.mine(copperSpot, v.id, v.deadline, v.sig);
    }

    function test_OnlyOwnerAddsSpots() public {
        vm.prank(miner);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, miner));
        mine.addSpot(1, 1, 1e18, 1);
    }

    function test_OnlyMintersMintItems() public {
        bytes32 role = items.MINTER_ROLE();
        uint256 pick = items.GOLD_PICKAXE(); // read before prank: prank only covers the next call
        vm.prank(miner);
        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, miner, role));
        items.mint(miner, pick, 1);
    }

    function test_PlayersCanBurnTheirOwnItems() public {
        uint256 fruit = items.DURIAN_FRUIT();
        items.mint(miner, fruit, 3);
        vm.prank(miner);
        items.burn(miner, fruit, 1);
        assertEq(items.balanceOf(miner, fruit), 2);
    }

    /// Mining any number of times, waiting out the cooldown between swings, pays exactly reward * swings.
    function testFuzz_RewardsAddUp(uint8 swings) public {
        vm.assume(swings > 0 && swings < 50);
        for (uint256 i = 0; i < swings; i++) {
            _mine(miner, copperSpot);
            vm.warp(block.timestamp + 8);
        }
        assertEq(token.balanceOf(miner), uint256(swings) * 10e18);
        assertEq(items.balanceOf(miner, items.COPPER_ORE()), swings);
        assertEq(token.balanceOf(address(mine)) + token.balanceOf(miner), 1_000_000e18);
    }

    /* --------------------------------------------------------- vouchers */

    function test_VoucherCannotBeReused() public {
        Voucher memory v = _voucher(mine, miner, copperSpot, signerKey);
        vm.prank(miner);
        mine.mine(copperSpot, v.id, v.deadline, v.sig);

        vm.warp(block.timestamp + 8); // cooldown over, so only the replay check can stop it
        vm.prank(miner);
        vm.expectRevert(abi.encodeWithSelector(DurianMine.VoucherAlreadyUsed.selector, v.id));
        mine.mine(copperSpot, v.id, v.deadline, v.sig);
    }

    function test_VoucherExpires() public {
        Voucher memory v = _voucher(mine, miner, copperSpot, signerKey);
        vm.warp(v.deadline + 1);
        vm.prank(miner);
        vm.expectRevert(abi.encodeWithSelector(DurianMine.VoucherExpired.selector, v.deadline));
        mine.mine(copperSpot, v.id, v.deadline, v.sig);
    }

    /// The front-running fix: a voucher copied out of the mempool is useless to anyone else.
    function test_VoucherIsBoundToItsMiner() public {
        Voucher memory v = _voucher(mine, miner, copperSpot, signerKey);
        address thief = makeAddr("thief");
        vm.prank(thief);
        vm.expectRevert(DurianMine.InvalidVoucher.selector);
        mine.mine(copperSpot, v.id, v.deadline, v.sig);
    }

    function test_VoucherIsBoundToItsSpot() public {
        Voucher memory v = _voucher(mine, miner, copperSpot, signerKey);
        vm.prank(miner);
        vm.expectRevert(DurianMine.InvalidVoucher.selector);
        mine.mine(goldSpot, v.id, v.deadline, v.sig);
    }

    function test_RejectsWrongSignerAndGarbage() public {
        Voucher memory v = _voucher(mine, miner, copperSpot, 0xBAD);
        vm.prank(miner);
        vm.expectRevert(DurianMine.InvalidVoucher.selector);
        mine.mine(copperSpot, v.id, v.deadline, v.sig);

        uint256 deadline = block.timestamp + 60;
        vm.prank(miner);
        vm.expectRevert(DurianMine.InvalidVoucher.selector);
        mine.mine(copperSpot, 77, deadline, hex"1234");
    }

    function test_RotatingSignerKillsOldVouchers() public {
        Voucher memory v = _voucher(mine, miner, copperSpot, signerKey);
        mine.setSigner(vm.addr(0xB0B));
        vm.prank(miner);
        vm.expectRevert(DurianMine.InvalidVoucher.selector);
        mine.mine(copperSpot, v.id, v.deadline, v.sig);

        vm.prank(miner);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, miner));
        mine.setSigner(miner);
    }
}
