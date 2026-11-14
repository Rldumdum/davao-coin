// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {DavaoCoin} from "../src/DavaoCoin.sol";
import {DavaoBank} from "../src/DavaoBank.sol";
import {PuzzleRewards} from "../src/PuzzleRewards.sol";
import {DurianMarket} from "../src/DurianMarket.sol";
import {DavaoItems} from "../src/DavaoItems.sol";
import {DurianMine} from "../src/DurianMine.sol";
import {Merchant} from "../src/Merchant.sol";

/// Everything both deployments share: the contracts, the mine spots, the merchants' prices and
/// stock, and writing `deployments/<chainId>.json` for the web app.
/// DeployLocal (anvil) and Deploy (Base Sepolia) only differ in keys, seeding and ETH amounts.
abstract contract DeployBase is Script {
    uint256 internal constant REWARD_POOL = 10_000_000e18;
    uint256 internal constant MINE_POOL = 5_000_000e18;

    DavaoCoin internal token;
    DavaoBank internal bank;
    PuzzleRewards internal rewards;
    DurianMarket internal market;
    DavaoItems internal items;
    DurianMine internal mine;
    Merchant internal nena;
    Merchant internal berto;
    Merchant internal jun;
    uint256 internal startBlock;

    /// Call between vm.startBroadcast / vm.stopBroadcast.
    /// @param signer the game server key that signs mining vouchers
    /// @param junEth ETH the money changer starts with (he pays it out for DURIAN)
    function _deployWorld(address deployer, address signer, uint256 junEth) internal {
        startBlock = block.number;
        token = new DavaoCoin(deployer);
        bank = new DavaoBank(token);
        rewards = new PuzzleRewards(token, deployer);
        market = new DurianMarket(token);

        token.transfer(address(rewards), REWARD_POOL);
        _addPuzzles();
        _deployGame(deployer, signer, junEth);
    }

    function _addPuzzles() internal {
        // Answers are hashed here and stored as hashes; the UI lowercases and trims answers.
        // (They're readable in this file, and brute-forceable anyway: PuzzleRewards is the
        // deliberately weak contract of the security milestone.)
        rewards.addPuzzle(
            "I'm called the King of Fruits, I'm banned on some trains for my smell, and Davao is famous for me. What am I?",
            keccak256("durian"),
            100e18
        );
        rewards.addPuzzle(
            "The highest mountain in the Philippines rises near Davao. What is its name, without the word 'Mount'?",
            keccak256("apo"),
            150e18
        );
        rewards.addPuzzle("What comes next: 1, 1, 2, 3, 5, 8, ...?", keccak256("13"), 200e18);
        rewards.addPuzzle(
            "A SHA-256 hash is 32 bytes. How many characters long is it when written in hex?", keccak256("64"), 250e18
        );
        rewards.addPuzzle(
            "This app runs on the EVM. What does the 'E' in EVM stand for?", keccak256("ethereum"), 300e18
        );
    }

    /// The 3D game: items, the mine on the slopes, and three merchants in the plaza.
    /// Spot ids here must match MINE_SPOTS in apps/web/shared/world.ts.
    function _deployGame(address deployer, address signer, uint256 junEth) internal {
        items = new DavaoItems(deployer);
        mine = new DurianMine(token, items, deployer, signer);
        items.grantRole(items.MINTER_ROLE(), address(mine));
        token.transfer(address(mine), MINE_POOL);

        // oreId, ore per swing, DURIAN per swing, cooldown seconds
        mine.addSpot(items.COPPER_ORE(), 1, 10e18, 8); // 0 copper vein (west)
        mine.addSpot(items.COPPER_ORE(), 1, 10e18, 8); // 1 copper vein (east)
        mine.addSpot(items.SILVER_ORE(), 1, 25e18, 20); // 2 silver vein
        mine.addSpot(items.SILVER_ORE(), 1, 25e18, 20); // 3 silver vein
        mine.addSpot(items.GOLD_NUGGET(), 1, 60e18, 45); // 4 gold seam
        mine.addSpot(items.APO_CRYSTAL(), 1, 150e18, 120); // 5 Apo crystal cave

        // Aling Nena: fruit stall. Prices are (merchant buys at, merchant sells at), in DURIAN.
        nena = new Merchant(token, items, "Aling Nena", deployer);
        nena.setItemPrice(items.DURIAN_FRUIT(), 18e18, 30e18);
        nena.setItemPrice(items.POMELO(), 9e18, 15e18);
        nena.setItemPrice(items.MANGOSTEEN(), 12e18, 20e18);
        token.transfer(address(nena), 200_000e18);
        items.mint(address(nena), items.DURIAN_FRUIT(), 2_000);
        items.mint(address(nena), items.POMELO(), 3_000);
        items.mint(address(nena), items.MANGOSTEEN(), 3_000);

        // Mang Berto: blacksmith. Buys ore, sells pickaxes (and some ore back).
        berto = new Merchant(token, items, "Mang Berto", deployer);
        berto.setItemPrice(items.COPPER_ORE(), 15e18, 25e18);
        berto.setItemPrice(items.SILVER_ORE(), 40e18, 65e18);
        berto.setItemPrice(items.GOLD_NUGGET(), 100e18, 160e18);
        berto.setItemPrice(items.APO_CRYSTAL(), 300e18, 500e18);
        berto.setItemPrice(items.IRON_PICKAXE(), 300e18, 600e18);
        berto.setItemPrice(items.GOLD_PICKAXE(), 1_250e18, 2_500e18);
        token.transfer(address(berto), 500_000e18);
        items.mint(address(berto), items.IRON_PICKAXE(), 200);
        items.mint(address(berto), items.GOLD_PICKAXE(), 50);
        items.mint(address(berto), items.COPPER_ORE(), 30);
        items.mint(address(berto), items.SILVER_ORE(), 15);
        items.mint(address(berto), items.GOLD_NUGGET(), 5);

        // Kuya Jun: money changer. ETH <-> DURIAN at 90k / 110k per ETH, and a collector of crystals.
        jun = new Merchant(token, items, "Kuya Jun", deployer);
        jun.setEthRate(90_000e18, 110_000e18);
        jun.setItemPrice(items.APO_CRYSTAL(), 350e18, 600e18);
        jun.setItemPrice(items.GOLD_NUGGET(), 110e18, 0); // buys only
        token.transfer(address(jun), 1_000_000e18);
        if (junEth > 0) jun.stockEth{value: junEth}();
        items.mint(address(jun), items.APO_CRYSTAL(), 2);
    }

    function _writeDeployment() internal {
        string memory key = "deployment";
        vm.serializeUint(key, "chainId", block.chainid);
        vm.serializeUint(key, "startBlock", startBlock);
        vm.serializeAddress(key, "DavaoCoin", address(token));
        vm.serializeAddress(key, "DavaoBank", address(bank));
        vm.serializeAddress(key, "PuzzleRewards", address(rewards));
        vm.serializeAddress(key, "DurianMarket", address(market));
        vm.serializeAddress(key, "DavaoItems", address(items));
        vm.serializeAddress(key, "DurianMine", address(mine));
        vm.serializeAddress(key, "MerchantNena", address(nena));
        vm.serializeAddress(key, "MerchantBerto", address(berto));
        string memory json = vm.serializeAddress(key, "MerchantJun", address(jun));
        string memory path = string.concat("./deployments/", vm.toString(block.chainid), ".json");
        vm.writeJson(json, path);

        console.log("DavaoCoin     ", address(token));
        console.log("DurianMine    ", address(mine));
        console.log("Merchants     ", address(nena), address(berto), address(jun));
        console.log("Wrote", path, "- now run `npm run sync` in apps/web");
    }
}
