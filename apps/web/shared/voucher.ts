// EIP-712 mining voucher: the server signs it, DurianMine.mine() verifies it.
// These definitions MUST match DurianMine.sol: EIP712("DurianMine", "1") and VOUCHER_TYPEHASH.
import type { Address, Hex } from 'viem';

export const VOUCHER_TYPES = {
  MineVoucher: [
    { name: 'miner', type: 'address' },
    { name: 'spotId', type: 'uint256' },
    { name: 'voucherId', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const;

export function voucherDomain(chainId: number, mine: Address) {
  return { name: 'DurianMine', version: '1', chainId, verifyingContract: mine } as const;
}

export interface MineVoucher {
  miner: Address;
  spotId: bigint;
  voucherId: bigint;
  deadline: bigint;
}

/** Vouchers expire quickly so a leaked one is useless soon after. */
export const VOUCHER_TTL_SECONDS = 120;

/** Over the wire, bigints travel as decimal strings. */
export interface VoucherJson {
  voucherId: string;
  deadline: string;
  signature: Hex;
}
