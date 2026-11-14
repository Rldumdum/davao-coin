// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {DavaoItems} from "./DavaoItems.sol";

/// @title DurianMine
/// @notice Mining spots in the game world. Swing at a spot, get DURIAN from the mine's pool
///         plus freshly minted ore. Each spot has a per-player cooldown.
/// @dev Pickaxes multiply the yield: owning an Iron Pickaxe = 2x, a Gold Pickaxe = 3x.
///
///      Every swing needs a VOUCHER: an EIP-712 signature from the game server saying
///      "miner X may mine spot Y, once (voucherId), before time T". The contract can't see the
///      game, so it can't know you walked to the rock and pressed E; the server can apply rules
///      the chain can't (stamina, rate limits per IP, daily caps). The contract's job shrinks to
///      checking the signature, the deadline, and that the voucher hasn't been used.
///
///      What this does NOT fix: a bot can still ask the server for vouchers. Vouchers move the
///      trust from "anyone with cast" to "whoever runs the server", which is where anti-cheat
///      rules can live. The on-chain cooldown stays as a second line of defense.
contract DurianMine is Ownable, EIP712 {
    using SafeERC20 for IERC20;

    struct Spot {
        uint256 oreId; // DavaoItems id minted on each swing
        uint256 oreAmount; // ore per swing, before the pickaxe bonus
        uint256 durianReward; // DURIAN per swing (18 decimals), before the pickaxe bonus
        uint64 cooldown; // seconds between swings, per player
        bool active;
    }

    bytes32 public constant VOUCHER_TYPEHASH =
        keccak256("MineVoucher(address miner,uint256 spotId,uint256 voucherId,uint256 deadline)");

    IERC20 public immutable token;
    DavaoItems public immutable items;
    /// @notice The game server key whose signatures count as vouchers.
    address public signer;
    mapping(uint256 voucherId => bool) public voucherUsed;

    Spot[] public spots;
    mapping(uint256 spotId => mapping(address miner => uint256 timestamp)) public nextMineAt;
    /// @notice Lifetime swings per player. The game turns this into an XP level.
    mapping(address miner => uint256 count) public timesMined;

    event SpotAdded(uint256 indexed spotId, uint256 oreId, uint256 durianReward, uint64 cooldown);
    event SpotActiveSet(uint256 indexed spotId, bool active);
    event SignerSet(address indexed signer);
    event Mined(uint256 indexed spotId, address indexed miner, uint256 durian, uint256 oreId, uint256 oreAmount);

    error UnknownSpot(uint256 spotId);
    error SpotInactive(uint256 spotId);
    error StillCoolingDown(uint256 spotId, uint256 readyAt);
    error MinePoolEmpty(uint256 available, uint256 needed);
    error VoucherExpired(uint256 deadline);
    error VoucherAlreadyUsed(uint256 voucherId);
    error InvalidVoucher();

    constructor(IERC20 token_, DavaoItems items_, address initialOwner, address signer_)
        Ownable(initialOwner)
        EIP712("DurianMine", "1")
    {
        token = token_;
        items = items_;
        signer = signer_;
        emit SignerSet(signer_);
    }

    /// @notice Rotate the server key (e.g. if it leaks). Old unused vouchers stop working.
    function setSigner(address signer_) external onlyOwner {
        signer = signer_;
        emit SignerSet(signer_);
    }

    function addSpot(uint256 oreId, uint256 oreAmount, uint256 durianReward, uint64 cooldown)
        external
        onlyOwner
        returns (uint256 spotId)
    {
        spotId = spots.length;
        spots.push(
            Spot({oreId: oreId, oreAmount: oreAmount, durianReward: durianReward, cooldown: cooldown, active: true})
        );
        emit SpotAdded(spotId, oreId, durianReward, cooldown);
    }

    function setSpotActive(uint256 spotId, bool active) external onlyOwner {
        if (spotId >= spots.length) revert UnknownSpot(spotId);
        spots[spotId].active = active;
        emit SpotActiveSet(spotId, active);
    }

    /// @notice Swing your pickaxe at `spotId`, using a voucher the game server signed for you.
    function mine(uint256 spotId, uint256 voucherId, uint256 deadline, bytes calldata signature) external {
        _useVoucher(spotId, voucherId, deadline, signature);
        _mine(spotId);
    }

    /// @dev Checks the server's signature and burns the voucher id so it can't be replayed.
    function _useVoucher(uint256 spotId, uint256 voucherId, uint256 deadline, bytes calldata signature) private {
        if (block.timestamp > deadline) revert VoucherExpired(deadline);
        if (voucherUsed[voucherId]) revert VoucherAlreadyUsed(voucherId);
        // msg.sender is part of the signed data, so a voucher copied from the mempool is useless
        // to anyone but the miner it was issued to. (Compare PuzzleRewards' front-running bug.)
        bytes32 digest = voucherDigest(msg.sender, spotId, voucherId, deadline);
        (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, signature);
        if (err != ECDSA.RecoverError.NoError || recovered != signer) revert InvalidVoucher();
        voucherUsed[voucherId] = true;
    }

    function _mine(uint256 spotId) private {
        if (spotId >= spots.length) revert UnknownSpot(spotId);
        Spot memory spot = spots[spotId];
        if (!spot.active) revert SpotInactive(spotId);

        uint256 readyAt = nextMineAt[spotId][msg.sender];
        if (block.timestamp < readyAt) revert StillCoolingDown(spotId, readyAt);

        uint256 bonus = pickaxeBonus(msg.sender);
        uint256 durian = spot.durianReward * bonus;
        uint256 ore = spot.oreAmount * bonus;
        uint256 pool = token.balanceOf(address(this));
        if (durian > pool) revert MinePoolEmpty(pool, durian);

        // Effects before interactions: _mint below calls back into the miner if it's a contract
        // (onERC1155Received), so the cooldown must already be set by then.
        nextMineAt[spotId][msg.sender] = block.timestamp + spot.cooldown;
        timesMined[msg.sender] += 1;
        emit Mined(spotId, msg.sender, durian, spot.oreId, ore);

        token.safeTransfer(msg.sender, durian);
        items.mint(msg.sender, spot.oreId, ore);
    }

    /// @notice The EIP-712 digest the server signs. Exposed so off-chain code can check its hashing.
    function voucherDigest(address miner, uint256 spotId, uint256 voucherId, uint256 deadline)
        public
        view
        returns (bytes32)
    {
        return _hashTypedDataV4(keccak256(abi.encode(VOUCHER_TYPEHASH, miner, spotId, voucherId, deadline)));
    }

    /// @notice Yield multiplier from the best pickaxe `miner` owns.
    function pickaxeBonus(address miner) public view returns (uint256) {
        if (items.balanceOf(miner, items.GOLD_PICKAXE()) > 0) return 3;
        if (items.balanceOf(miner, items.IRON_PICKAXE()) > 0) return 2;
        return 1;
    }

    function spotCount() external view returns (uint256) {
        return spots.length;
    }

    function minePool() external view returns (uint256) {
        return token.balanceOf(address(this));
    }
}
