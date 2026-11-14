// Request/response shapes of the game API (apps/web/api/*). Imported by both sides so a
// change on one side is a type error on the other.
import type { Hex } from 'viem';
import type { VoucherJson } from './voucher.js';

/** Stamina snapshot: `value` at time `at` (ms epoch). Regenerates from there; see staminaAt(). */
export interface StaminaJson {
  value: number;
  at: number;
}

export interface SessionRequest {
  address: string;
}
export interface SessionResponse {
  stamina: StaminaJson;
  /** Set when the faucet just sent you gas money; wait for this tx before your first write. */
  drip: { hash: Hex; amountWei: string } | null;
  /** Why no drip was sent, when the wallet is low on gas but the faucet said no. */
  dripRefused?: string;
}

export interface MineRequest {
  address: string;
  spotId: number;
}
export interface MineResponse {
  voucher: VoucherJson;
  stamina: StaminaJson;
}

export interface EatRequest {
  address: string;
  /** The burn transaction: DavaoItems.burn(you, fruitId, n). The server reads it from the chain. */
  txHash: string;
}
export interface EatResponse {
  stamina: StaminaJson;
}

export type ApiErrorCode =
  | 'bad_request'
  | 'too_tired'
  | 'cooling_down'
  | 'rate_limited'
  | 'not_a_meal'
  | 'already_eaten'
  | 'server_error';

export interface ApiError {
  error: ApiErrorCode;
  message: string;
  stamina?: StaminaJson;
}
