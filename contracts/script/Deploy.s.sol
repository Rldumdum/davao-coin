// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {DeployBase} from "./DeployBase.s.sol";

/// Deploys the world to a public TESTNET. Keys come from the environment, never from files in git.
///
///   cp .env.example .env        # fill in DEPLOYER_PRIVATE_KEY, VOUCHER_SIGNER, BASESCAN_API_KEY
///   source .env
///   forge script script/Deploy.s.sol --rpc-url base_sepolia --broadcast --verify
///
/// Refuses to run anywhere except known testnets: this project never goes to mainnet.
contract Deploy is DeployBase {
    uint256 internal constant BASE_SEPOLIA = 84532;
    uint256 internal constant SEPOLIA = 11155111;

    function run() external {
        require(block.chainid == BASE_SEPOLIA || block.chainid == SEPOLIA, "Deploy is for testnets only");

        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address signer = vm.envAddress("VOUCHER_SIGNER");
        // Testnet ETH is scarce; the money changer starts small.
        uint256 junEth = vm.envOr("JUN_ETH_WEI", uint256(0.01 ether));

        vm.startBroadcast(deployerKey);
        _deployWorld(vm.addr(deployerKey), signer, junEth);
        vm.stopBroadcast();

        _writeDeployment();
    }
}
