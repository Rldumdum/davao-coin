// Application layer for the 3D game: every chain read and write the game makes.
// Like services/davao.ts, the game and HUD never call viem directly.
import { parseEventLogs, type Address, type Hash, type Hex } from 'viem';
import type { StaminaJson } from '../../shared/api';
import { ADDRESSES, IS_DEPLOYED, davaoCoinAbi, davaoItemsAbi, durianMineAbi, merchantAbi } from '../lib/contracts';
import { SAMPLE_PEOPLE, publicClient, walletClient, you } from '../lib/chain';
import { ALL_ITEM_IDS, MERCHANTS, MINE_SPOTS, type ItemId, type MerchantKey } from '../game/world-data';
import { api } from './api';

const coin = { address: ADDRESSES.DavaoCoin, abi: davaoCoinAbi } as const;
const items = { address: ADDRESSES.DavaoItems, abi: davaoItemsAbi } as const;
const mineContract = { address: ADDRESSES.DurianMine, abi: durianMineAbi } as const;

/* ------------------------------------------------------------------ types */

export type ItemCounts = Partial<Record<ItemId, bigint>>;

export interface Price {
  buy: bigint; // merchant credits you this per unit you give (0 = won't take it)
  sell: bigint; // merchant charges this per unit you take (0 = won't sell it)
}

export interface MerchantState {
  key: MerchantKey;
  address: Address;
  name: string;
  catalog: ItemId[];
  prices: Partial<Record<ItemId, Price>>;
  ethRate: Price;
  stock: { durian: bigint; eth: bigint; items: ItemCounts };
}

export interface SpotState {
  spotId: number;
  oreId: number;
  oreAmount: bigint;
  durianReward: bigint;
  cooldown: number;
  active: boolean;
  /** Unix seconds when you can swing again (0 = never mined). */
  readyAt: number;
}

export interface GameState {
  blockNumber: bigint;
  eth: bigint;
  durian: bigint;
  items: ItemCounts;
  timesMined: number;
  pickaxeBonus: number;
  minePool: bigint;
  spots: SpotState[];
  merchants: Record<MerchantKey, MerchantState>;
  villagers: { name: string; durian: bigint }[];
}

/** A trade side, mirroring Merchant.Bundle. */
export interface Bundle {
  durian: bigint;
  eth: bigint;
  items: ItemCounts;
}

/* ------------------------------------------------------------------ reads */

export async function gameIsDeployed(): Promise<boolean> {
  if (!IS_DEPLOYED) return false;
  const code = await publicClient.getCode({ address: ADDRESSES.DurianMine });
  return code !== undefined && code !== '0x';
}

async function balancesOf(owner: Address, ids: readonly ItemId[]): Promise<ItemCounts> {
  if (ids.length === 0) return {};
  const amounts = await publicClient.readContract({
    ...items,
    functionName: 'balanceOfBatch',
    args: [ids.map(() => owner), ids.map((id) => BigInt(id))],
  });
  const out: ItemCounts = {};
  ids.forEach((id, i) => (out[id] = amounts[i] ?? 0n));
  return out;
}

async function loadMerchant(key: MerchantKey): Promise<MerchantState> {
  const info = MERCHANTS.find((m) => m.key === key)!;
  const address = ADDRESSES[info.addressKey] as Address;
  const m = { address, abi: merchantAbi } as const;

  const [name, catalogRaw, [ethBuy, ethSell], durian, eth] = await Promise.all([
    publicClient.readContract({ ...m, functionName: 'name' }),
    publicClient.readContract({ ...m, functionName: 'catalog' }),
    publicClient.readContract({ ...m, functionName: 'ethRate' }),
    publicClient.readContract({ ...coin, functionName: 'balanceOf', args: [address] }),
    publicClient.getBalance({ address }),
  ]);
  const catalog = catalogRaw.map((id) => Number(id) as ItemId);

  const [priceList, stockItems] = await Promise.all([
    Promise.all(catalog.map((id) => publicClient.readContract({ ...m, functionName: 'itemPrice', args: [BigInt(id)] }))),
    balancesOf(address, catalog),
  ]);
  const prices: MerchantState['prices'] = {};
  catalog.forEach((id, i) => {
    const [buy, sell] = priceList[i]!;
    prices[id] = { buy, sell };
  });

  return { key, address, name, catalog, prices, ethRate: { buy: ethBuy, sell: ethSell }, stock: { durian, eth, items: stockItems } };
}

export async function loadGameState(): Promise<GameState> {
  const [blockNumber, eth, durian, inventory, timesMined, pickaxeBonus, minePool, spots, merchantList, villagers] =
    await Promise.all([
      publicClient.getBlockNumber(),
      publicClient.getBalance({ address: you.address }),
      publicClient.readContract({ ...coin, functionName: 'balanceOf', args: [you.address] }),
      balancesOf(you.address, ALL_ITEM_IDS),
      publicClient.readContract({ ...mineContract, functionName: 'timesMined', args: [you.address] }),
      publicClient.readContract({ ...mineContract, functionName: 'pickaxeBonus', args: [you.address] }),
      publicClient.readContract({ ...mineContract, functionName: 'minePool' }),
      Promise.all(
        MINE_SPOTS.map(async ({ spotId }): Promise<SpotState> => {
          const id = BigInt(spotId);
          const [[oreId, oreAmount, durianReward, cooldown, active], readyAt] = await Promise.all([
            publicClient.readContract({ ...mineContract, functionName: 'spots', args: [id] }),
            publicClient.readContract({ ...mineContract, functionName: 'nextMineAt', args: [id, you.address] }),
          ]);
          return { spotId, oreId: Number(oreId), oreAmount, durianReward, cooldown: Number(cooldown), active, readyAt: Number(readyAt) };
        }),
      ),
      Promise.all(MERCHANTS.map((m) => loadMerchant(m.key))),
      Promise.all(
        SAMPLE_PEOPLE.map(async ({ name, address }) => ({
          name,
          durian: await publicClient.readContract({ ...coin, functionName: 'balanceOf', args: [address] }),
        })),
      ),
    ]);

  const merchants = Object.fromEntries(merchantList.map((m) => [m.key, m])) as Record<MerchantKey, MerchantState>;
  return {
    blockNumber,
    eth,
    durian,
    items: inventory,
    timesMined: Number(timesMined),
    pickaxeBonus: Number(pickaxeBonus),
    minePool,
    spots,
    merchants,
    villagers,
  };
}

/* ------------------------------------------------------------ trade math */

const ONE_ETHER = 10n ** 18n;
const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

/**
 * Client-side copy of Merchant.quote(), so the trade window can react on every click.
 * The contract re-checks everything; this only predicts the answer.
 * Returns null if the merchant won't trade something in the bundle.
 */
export function quote(merchant: MerchantState, give: Bundle, take: Bundle): { give: bigint; take: bigint } | null {
  let giveValue = give.durian;
  if (give.eth > 0n) {
    if (merchant.ethRate.buy === 0n) return null;
    giveValue += (give.eth * merchant.ethRate.buy) / ONE_ETHER; // rounds down, like the contract
  }
  let takeValue = take.durian;
  if (take.eth > 0n) {
    if (merchant.ethRate.sell === 0n) return null;
    takeValue += ceilDiv(take.eth * merchant.ethRate.sell, ONE_ETHER); // rounds up, like the contract
  }
  for (const [id, n] of entries(give.items)) {
    const p = merchant.prices[id]?.buy ?? 0n;
    if (p === 0n) return null;
    giveValue += p * n;
  }
  for (const [id, n] of entries(take.items)) {
    const p = merchant.prices[id]?.sell ?? 0n;
    if (p === 0n) return null;
    takeValue += p * n;
  }
  return { give: giveValue, take: takeValue };
}

export function entries(counts: ItemCounts): [ItemId, bigint][] {
  return (Object.entries(counts) as [string, bigint][])
    .filter(([, n]) => n > 0n)
    .map(([id, n]) => [Number(id) as ItemId, n]);
}

export const isEmptyBundle = (b: Bundle) => b.durian === 0n && b.eth === 0n && entries(b.items).length === 0;

function toContractBundle(b: Bundle) {
  const list = entries(b.items);
  return { durian: b.durian, eth: b.eth, ids: list.map(([id]) => BigInt(id)), amounts: list.map(([, n]) => n) };
}

/* ----------------------------------------------------------------- writes */

export interface TxRecord {
  step: string;
  hash: Hash;
  block: bigint;
}
export type OnTx = (tx: TxRecord) => void;

/**
 * One wallet, one nonce sequence. If two writes were sent at once (mine a rock while a trade
 * is confirming), both could grab the same nonce and one would fail. So every write waits its turn.
 */
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job);
  queue = run.catch(() => undefined);
  return run;
}

async function send(step: string, hash: Hash, onTx: OnTx) {
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error(`${step} reverted`);
  onTx({ step, hash, block: receipt.blockNumber });
  return receipt;
}

/* ---------------------------------------------------------------- session */

export interface SessionInfo {
  stamina: StaminaJson;
  /** Gas money the faucet sent this session wallet, already confirmed on-chain. */
  dripWei: bigint | null;
  dripRefused?: string;
}

/**
 * Registers this browser's session wallet with the game server. A brand-new wallet has no ETH
 * for gas, so the server's faucet sends some; we wait for it before letting the player act.
 */
export async function startSession(): Promise<SessionInfo> {
  const res = await api.session({ address: you.address });
  if (res.drip) await publicClient.waitForTransactionReceipt({ hash: res.drip.hash });
  return { stamina: res.stamina, dripWei: res.drip ? BigInt(res.drip.amountWei) : null, dripRefused: res.dripRefused };
}

/* ------------------------------------------------------------------- mine */

export interface MineResult {
  durian: bigint;
  oreId: number;
  oreAmount: bigint;
  stamina: StaminaJson;
}

/**
 * Two steps: ask the game server for a voucher (it checks stamina and rate limits and signs),
 * then send the voucher to DurianMine, which checks the signature.
 */
export function mine(spotId: number, onTx: OnTx): Promise<MineResult> {
  return serial(async () => {
    const { voucher, stamina } = await api.mine({ address: you.address, spotId });
    const { request } = await publicClient.simulateContract({
      ...mineContract,
      account: you,
      functionName: 'mine',
      args: [BigInt(spotId), BigInt(voucher.voucherId), BigInt(voucher.deadline), voucher.signature as Hex],
    });
    const receipt = await send('Mine', await walletClient.writeContract(request), onTx);
    const [event] = parseEventLogs({ abi: durianMineAbi, eventName: 'Mined', logs: receipt.logs });
    if (!event) throw new Error('Mined event missing from receipt');
    return { durian: event.args.durian, oreId: Number(event.args.oreId), oreAmount: event.args.oreAmount, stamina };
  });
}

/**
 * Eating = burning one fruit token on-chain, then showing the receipt to the game server,
 * which reads the burn from the chain itself and credits stamina (once per transaction).
 */
export function eat(itemId: ItemId, onTx: OnTx): Promise<StaminaJson> {
  return serial(async () => {
    const { request } = await publicClient.simulateContract({
      ...items,
      account: you,
      functionName: 'burn',
      args: [you.address, BigInt(itemId), 1n],
    });
    const hash = await walletClient.writeContract(request);
    await send('Eat', hash, onTx);
    const { stamina } = await api.eat({ address: you.address, txHash: hash });
    return stamina;
  });
}

/**
 * The merchant pulls what you give, so it needs permission first:
 *  - DURIAN (ERC-20): approve exactly this trade's amount.
 *  - Items (ERC-1155): there's no per-amount approval in ERC-1155, only all-or-nothing
 *    setApprovalForAll. It's safe here only because Merchant.trade() pulls from msg.sender.
 */
export function trade(merchant: MerchantState, give: Bundle, take: Bundle, onTx: OnTx): Promise<void> {
  return serial(async () => {
    if (give.durian > 0n) {
      const allowance = await publicClient.readContract({
        ...coin,
        functionName: 'allowance',
        args: [you.address, merchant.address],
      });
      if (allowance < give.durian) {
        const { request } = await publicClient.simulateContract({
          ...coin,
          account: you,
          functionName: 'approve',
          args: [merchant.address, give.durian],
        });
        await send('Approve DURIAN', await walletClient.writeContract(request), onTx);
      }
    }
    if (entries(give.items).length > 0) {
      const approved = await publicClient.readContract({
        ...items,
        functionName: 'isApprovedForAll',
        args: [you.address, merchant.address],
      });
      if (!approved) {
        const { request } = await publicClient.simulateContract({
          ...items,
          account: you,
          functionName: 'setApprovalForAll',
          args: [merchant.address, true],
        });
        await send('Approve items', await walletClient.writeContract(request), onTx);
      }
    }
    const { request } = await publicClient.simulateContract({
      address: merchant.address,
      abi: merchantAbi,
      account: you,
      functionName: 'trade',
      args: [toContractBundle(give), toContractBundle(take)],
      value: give.eth,
    });
    await send('Trade', await walletClient.writeContract(request), onTx);
  });
}
