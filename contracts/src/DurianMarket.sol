// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

/// @title DurianMarket
/// @notice Peer-to-peer market: sellers list DURIAN for a fixed ETH price, buyers take whole offers.
/// @dev Listed tokens are held in escrow by this contract until bought or cancelled, so a seller
///      can't list tokens and then spend them elsewhere. Sale proceeds use the pull-payment
///      pattern: they accrue in `proceeds` and sellers withdraw them, so a seller whose address
///      rejects ETH can never block buyers.
contract DurianMarket is ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    struct Offer {
        address seller;
        uint256 amount; // DURIAN, in base units (18 decimals)
        uint256 priceWei; // total ETH price for the whole amount
        bool active;
    }

    IERC20 public immutable token;
    Offer[] public offers;
    mapping(address seller => uint256 weiOwed) public proceeds;

    event OfferCreated(uint256 indexed offerId, address indexed seller, uint256 amount, uint256 priceWei);
    event OfferCancelled(uint256 indexed offerId);
    event OfferFilled(
        uint256 indexed offerId, address indexed buyer, address indexed seller, uint256 amount, uint256 priceWei
    );
    event ProceedsWithdrawn(address indexed seller, uint256 amountWei);

    error ZeroAmount();
    error ZeroPrice();
    error UnknownOffer(uint256 offerId);
    error OfferNotActive(uint256 offerId);
    error NotSeller(uint256 offerId);
    error CannotBuyOwnOffer(uint256 offerId);
    error WrongPayment(uint256 expectedWei, uint256 sentWei);
    error NoProceeds();
    error EthTransferFailed();

    constructor(IERC20 token_) {
        token = token_;
    }

    /// @dev Caller must first `approve` this contract on the token for at least `amount`.
    function createOffer(uint256 amount, uint256 priceWei) external nonReentrant returns (uint256 offerId) {
        if (amount == 0) revert ZeroAmount();
        if (priceWei == 0) revert ZeroPrice();

        offerId = offers.length;
        offers.push(Offer({seller: msg.sender, amount: amount, priceWei: priceWei, active: true}));
        emit OfferCreated(offerId, msg.sender, amount, priceWei);

        token.safeTransferFrom(msg.sender, address(this), amount);
    }

    function cancelOffer(uint256 offerId) external nonReentrant {
        Offer storage offer = _activeOffer(offerId);
        if (offer.seller != msg.sender) revert NotSeller(offerId);

        offer.active = false;
        emit OfferCancelled(offerId);

        token.safeTransfer(msg.sender, offer.amount);
    }

    function buy(uint256 offerId) external payable nonReentrant {
        Offer storage offer = _activeOffer(offerId);
        if (offer.seller == msg.sender) revert CannotBuyOwnOffer(offerId);
        if (msg.value != offer.priceWei) revert WrongPayment(offer.priceWei, msg.value);

        offer.active = false;
        proceeds[offer.seller] += msg.value;
        emit OfferFilled(offerId, msg.sender, offer.seller, offer.amount, offer.priceWei);

        token.safeTransfer(msg.sender, offer.amount);
    }

    function withdrawProceeds() external nonReentrant {
        uint256 owed = proceeds[msg.sender];
        if (owed == 0) revert NoProceeds();

        proceeds[msg.sender] = 0;
        emit ProceedsWithdrawn(msg.sender, owed);

        (bool ok,) = msg.sender.call{value: owed}("");
        if (!ok) revert EthTransferFailed();
    }

    function offerCount() external view returns (uint256) {
        return offers.length;
    }

    function _activeOffer(uint256 offerId) private view returns (Offer storage offer) {
        if (offerId >= offers.length) revert UnknownOffer(offerId);
        offer = offers[offerId];
        if (!offer.active) revert OfferNotActive(offerId);
    }
}
