// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {DeployBase} from "./DeployBase.s.sol";

/// Deploys the whole Davao Coin world to a local anvil chain and seeds it with sample people.
///
///   anvil                                   (terminal 1)
///   forge script script/DeployLocal.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
///
/// Accounts come from anvil's public test mnemonic. Never use these keys on a real network.
///   #0 deployer / treasury / local faucet    #1 Inday   #2 Dodong   #3 Nonoy   #4 Ging
///   #9 voucher signer (the local game API signs with it)
/// Players are session wallets created in the browser and funded by the faucet API.
contract DeployLocal is DeployBase {
    string internal constant ANVIL_MNEMONIC = "test test test test test test test test test test test junk";
    uint32 internal constant SIGNER_INDEX = 9;
    uint256 internal constant PERSON_STARTING_BALANCE = 50_000e18;

    function run() external {
        require(block.chainid == 31337, "DeployLocal is for anvil only");

        uint256 deployerKey = vm.deriveKey(ANVIL_MNEMONIC, 0);
        address deployer = vm.addr(deployerKey);
        address signer = vm.addr(vm.deriveKey(ANVIL_MNEMONIC, SIGNER_INDEX));

        vm.startBroadcast(deployerKey);
        _deployWorld(deployer, signer, 50 ether);
        for (uint32 i = 1; i <= 4; i++) {
            token.transfer(vm.addr(vm.deriveKey(ANVIL_MNEMONIC, i)), PERSON_STARTING_BALANCE);
        }
        vm.stopBroadcast();

        // Each sample person banks some DURIAN and lists some for sale.
        _seedPerson(1, 10_000e18, 1_000e18, 0.01 ether, 5_000e18, 0.045 ether); // Inday
        _seedPerson(2, 0, 2_500e18, 0.02 ether, 0, 0); // Dodong
        _seedPerson(3, 5_000e18, 10_000e18, 0.08 ether, 0, 0); // Nonoy
        _seedPerson(4, 2_000e18, 500e18, 0.006 ether, 20_000e18, 0.15 ether); // Ging

        _writeDeployment();
    }

    function _seedPerson(
        uint32 index,
        uint256 bankDeposit,
        uint256 offer1Amount,
        uint256 offer1Price,
        uint256 offer2Amount,
        uint256 offer2Price
    ) internal {
        uint256 key = vm.deriveKey(ANVIL_MNEMONIC, index);
        vm.startBroadcast(key);
        if (bankDeposit > 0) {
            token.approve(address(bank), bankDeposit);
            bank.deposit(bankDeposit);
        }
        token.approve(address(market), offer1Amount + offer2Amount);
        market.createOffer(offer1Amount, offer1Price);
        if (offer2Amount > 0) market.createOffer(offer2Amount, offer2Price);
        vm.stopBroadcast();
    }
}
