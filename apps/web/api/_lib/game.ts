// The game server's rules. No HTTP, no env, no SDKs: everything comes in through `Deps`,
// which is what makes this file unit-testable (see game.test.ts).
import { isAddress, parseEventLogs, zeroAddress, type Address, type Hex, type TransactionReceipt } from 'viem';
import { davaoItemsAbi } from '../../shared/abis.js';
import type { EatResponse, ApiErrorCode, MineResponse, SessionResponse, StaminaJson } from '../../shared/api.js';
import { ITEMS, MINE_SPOTS, STAMINA } from '../../shared/rules.js';
import { VOUCHER_TTL_SECONDS, type MineVoucher } from '../../shared/voucher.js';
import type { ServerConfig } from './config.js';
import type { Store } from './store.js';

/** Everything the server needs from the blockchain. chain.ts implements it with viem. */
export interface ChainPort {
  ethBalance(address: Address): Promise<bigint>;
  /** DurianMine.nextMineAt(spotId, miner), unix seconds. */
  nextMineAt(spotId: number, miner: Address): Promise<bigint>;
  sendDrip(to: Address, wei: bigint): Promise<Hex>;
  signVoucher(voucher: MineVoucher): Promise<Hex>;
  /** Waits briefly for the receipt (RPC nodes can lag the client by a block). */
  receipt(hash: Hex): Promise<TransactionReceipt | null>;
  itemsAddress: Address;
}

export interface Deps {
  store: Store;
  chain: ChainPort;
  config: Pick<ServerConfig, 'dripWei' | 'limits'>;
  now(): number;
  randomId(): bigint;
}

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly stamina?: StaminaJson,
  ) {
    super(message);
  }
}

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** Lowercased, validated address: one canonical form for database keys. */
export function parseAddress(input: unknown): Address {
  if (typeof input !== 'string' || !isAddress(input, { strict: false })) {
    throw new ApiFailure(400, 'bad_request', 'address must be a 0x-prefixed 20-byte hex address');
  }
  return input.toLowerCase() as Address;
}

/* ---------------------------------------------------------------- session */

/**
 * Called when the game loads. Registers the player and, if their session wallet can't pay
 * for gas, sends a small drip from the faucet wallet.
 */
export async function startSession(deps: Deps, address: Address, ipHash: string): Promise<SessionResponse> {
  const { store, chain, config } = deps;
  const stamina = await store.ensurePlayer(address, deps.now());

  const balance = await chain.ethBalance(address);
  if (balance >= config.dripWei / 2n) return { stamina, drip: null };

  const since = deps.now() - DAY;
  // Faucets get drained by scripts creating fresh wallets, so the limits are per IP and global,
  // not just per address.
  if ((await store.countDrips({ address, sinceMs: since })) > 0) {
    return { stamina, drip: null, dripRefused: 'This wallet already got gas money today.' };
  }
  if ((await store.countDrips({ ipHash, sinceMs: since })) >= config.limits.dripsPerIpPerDay) {
    return { stamina, drip: null, dripRefused: 'Too many new wallets from your network today.' };
  }
  if ((await store.countDrips({ sinceMs: since })) >= config.limits.dripsPerDay) {
    return { stamina, drip: null, dripRefused: 'The faucet has hit its daily limit. Try again tomorrow.' };
  }

  const hash = await chain.sendDrip(address, config.dripWei);
  await store.recordDrip({ address, ipHash, txHash: hash, amountWei: config.dripWei.toString() }, deps.now());
  return { stamina, drip: { hash, amountWei: config.dripWei.toString() } };
}

/* ------------------------------------------------------------------- mine */

/**
 * The server's half of a swing. Checks what the chain can't (stamina, rate limits), then
 * signs a voucher only `address` can use, only at `spotId`, only once, only for 2 minutes.
 */
export async function requestMine(deps: Deps, address: Address, spotId: unknown, ipHash: string): Promise<MineResponse> {
  const { store, chain, config } = deps;
  if (typeof spotId !== 'number' || !MINE_SPOTS.some((s) => s.spotId === spotId)) {
    throw new ApiFailure(400, 'bad_request', 'unknown spotId');
  }
  const now = deps.now();

  if ((await store.countSwings({ ipHash, sinceMs: now - MINUTE })) >= config.limits.swingsPerIpPerMinute) {
    throw new ApiFailure(429, 'rate_limited', 'Too many swings from your network. Slow down.');
  }
  if ((await store.countSwings({ address, sinceMs: now - DAY })) >= config.limits.swingsPerAddressPerDay) {
    throw new ApiFailure(429, 'rate_limited', "You've mined enough for one day. The mountain needs rest.");
  }

  // Check the on-chain cooldown before spending stamina on a voucher that would revert.
  const readyAt = Number(await chain.nextMineAt(spotId, address));
  const left = readyAt - Math.floor(now / 1000);
  if (left > 0) throw new ApiFailure(409, 'cooling_down', `This vein regrows in ${left}s.`);

  const stamina = await store.spendStamina(address, STAMINA.mineCost, now);
  if (!stamina) {
    const current = await store.ensurePlayer(address, now);
    throw new ApiFailure(409, 'too_tired', 'Out of stamina. Eat some fruit.', current);
  }

  const voucher: MineVoucher = {
    miner: address,
    spotId: BigInt(spotId),
    voucherId: deps.randomId(),
    deadline: BigInt(Math.floor(now / 1000) + VOUCHER_TTL_SECONDS),
  };
  const signature = await chain.signVoucher(voucher);
  await store.recordSwing({ address, spotId, voucherId: voucher.voucherId.toString(), ipHash }, now);

  return {
    voucher: { voucherId: voucher.voucherId.toString(), deadline: voucher.deadline.toString(), signature },
    stamina,
  };
}

/* -------------------------------------------------------------------- eat */

/**
 * Stamina for food. The client burns a fruit on-chain and sends us the tx hash; we read the
 * receipt ourselves rather than trusting the client's word about what it ate.
 */
export async function eat(deps: Deps, address: Address, txHash: unknown): Promise<EatResponse> {
  if (typeof txHash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    throw new ApiFailure(400, 'bad_request', 'txHash must be a 32-byte hex string');
  }
  const receipt = await deps.chain.receipt(txHash as Hex);
  if (!receipt || receipt.status !== 'success') throw new ApiFailure(400, 'not_a_meal', 'Transaction not found or reverted.');

  const items = deps.chain.itemsAddress.toLowerCase();
  const burns = parseEventLogs({ abi: davaoItemsAbi, logs: receipt.logs, eventName: ['TransferSingle', 'TransferBatch'] }).filter(
    (log) => log.address.toLowerCase() === items && log.args.from.toLowerCase() === address && log.args.to === zeroAddress,
  );

  let gained = 0;
  let firstFruit = 0;
  for (const log of burns) {
    const pairs: [bigint, bigint][] =
      log.eventName === 'TransferSingle'
        ? [[log.args.id, log.args.value]]
        : log.args.ids.map((id, i) => [id, log.args.values[i] ?? 0n] as [bigint, bigint]);
    for (const [id, n] of pairs) {
      const fruit = ITEMS.find((i) => i.id === Number(id) && i.kind === 'fruit');
      if (!fruit) continue;
      gained += (fruit.stamina ?? 0) * Number(n);
      firstFruit ||= fruit.id;
    }
  }
  if (gained === 0) throw new ApiFailure(400, 'not_a_meal', 'That transaction did not burn any of your fruit.');

  const stamina = await deps.store.eat({ txHash: txHash.toLowerCase(), address, itemId: firstFruit, stamina: gained }, deps.now());
  if (!stamina) throw new ApiFailure(409, 'already_eaten', 'That meal was already counted.');
  return { stamina };
}
