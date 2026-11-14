// Application layer: everything the UI can read from or do to the contracts.
// Components never call viem directly; they call these functions.
import type { Address, Hash } from 'viem';
import {
  ADDRESSES,
  davaoBankAbi,
  davaoCoinAbi,
  durianMarketAbi,
  puzzleRewardsAbi,
} from '../lib/contracts';
import { SAMPLE_PEOPLE, publicClient, walletClient, you } from '../lib/chain';

const coin = { address: ADDRESSES.DavaoCoin, abi: davaoCoinAbi } as const;
const bank = { address: ADDRESSES.DavaoBank, abi: davaoBankAbi } as const;
const rewards = { address: ADDRESSES.PuzzleRewards, abi: puzzleRewardsAbi } as const;
const market = { address: ADDRESSES.DurianMarket, abi: durianMarketAbi } as const;

/* ------------------------------------------------------------------ reads */

export interface Puzzle {
  id: bigint;
  question: string;
  reward: bigint;
  active: boolean;
  solved: boolean;
}

export interface Offer {
  id: bigint;
  seller: Address;
  amount: bigint;
  priceWei: bigint;
  active: boolean;
}

export interface Holder {
  name: string;
  address: Address;
  wallet: bigint;
  bank: bigint;
}

export interface Snapshot {
  blockNumber: bigint;
  eth: bigint;
  wallet: bigint;
  bank: bigint;
  proceeds: bigint;
  rewardPool: bigint;
  puzzles: Puzzle[];
  offers: Offer[];
  people: Holder[];
}

const ids = (count: bigint) => Array.from({ length: Number(count) }, (_, i) => BigInt(i));

export async function contractsAreDeployed(): Promise<boolean> {
  const code = await publicClient.getCode({ address: ADDRESSES.DavaoCoin });
  return code !== undefined && code !== '0x';
}

export async function loadSnapshot(): Promise<Snapshot> {
  const [blockNumber, eth, wallet, bankBalance, proceeds, rewardPool, puzzleCount, offerCount] =
    await Promise.all([
      publicClient.getBlockNumber(),
      publicClient.getBalance({ address: you.address }),
      publicClient.readContract({ ...coin, functionName: 'balanceOf', args: [you.address] }),
      publicClient.readContract({ ...bank, functionName: 'balanceOf', args: [you.address] }),
      publicClient.readContract({ ...market, functionName: 'proceeds', args: [you.address] }),
      publicClient.readContract({ ...rewards, functionName: 'rewardPool' }),
      publicClient.readContract({ ...rewards, functionName: 'puzzleCount' }),
      publicClient.readContract({ ...market, functionName: 'offerCount' }),
    ]);

  const [puzzles, offers, people] = await Promise.all([
    Promise.all(
      ids(puzzleCount).map(async (id): Promise<Puzzle> => {
        const [[question, , reward, active], solved] = await Promise.all([
          publicClient.readContract({ ...rewards, functionName: 'puzzles', args: [id] }),
          publicClient.readContract({ ...rewards, functionName: 'hasSolved', args: [id, you.address] }),
        ]);
        return { id, question, reward, active, solved };
      }),
    ),
    Promise.all(
      ids(offerCount).map(async (id): Promise<Offer> => {
        const [seller, amount, priceWei, active] = await publicClient.readContract({
          ...market,
          functionName: 'offers',
          args: [id],
        });
        return { id, seller, amount, priceWei, active };
      }),
    ),
    Promise.all(
      SAMPLE_PEOPLE.map(async ({ name, address }): Promise<Holder> => {
        const [w, b] = await Promise.all([
          publicClient.readContract({ ...coin, functionName: 'balanceOf', args: [address] }),
          publicClient.readContract({ ...bank, functionName: 'balanceOf', args: [address] }),
        ]);
        return { name, address, wallet: w, bank: b };
      }),
    ),
  ]);

  return { blockNumber, eth, wallet, bank: bankBalance, proceeds, rewardPool, puzzles, offers, people };
}

/* ----------------------------------------------------------------- writes */

/** Called once per transaction sent, so the UI can show each step (e.g. approve, then deposit). */
export type OnTx = (step: string, hash: Hash) => void;

/** Waits for the transaction to be mined and fails loudly if it reverted. */
async function confirm(step: string, hash: Hash, onTx: OnTx): Promise<void> {
  onTx(step, hash);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error(`${step} reverted`);
}

/**
 * ERC-20 contracts can't see tokens arrive, so a contract that needs to pull your tokens
 * (bank deposit, market listing) must first be approved to spend them. That's two transactions.
 */
async function ensureAllowance(spender: Address, amount: bigint, onTx: OnTx): Promise<void> {
  const current = await publicClient.readContract({
    ...coin,
    functionName: 'allowance',
    args: [you.address, spender],
  });
  if (current >= amount) return;

  // simulate first: if it would revert, we find out (with the reason) before paying gas
  const { request } = await publicClient.simulateContract({
    ...coin,
    account: you,
    functionName: 'approve',
    args: [spender, amount],
  });
  await confirm('Approve', await walletClient.writeContract(request), onTx);
}

/** Answers are compared by hash, so "  Durian " must become exactly "durian". */
export const normalizeAnswer = (answer: string) => answer.trim().toLowerCase();

export async function solvePuzzle(id: bigint, answer: string, onTx: OnTx) {
  const { request } = await publicClient.simulateContract({
    ...rewards,
    account: you,
    functionName: 'solve',
    args: [id, normalizeAnswer(answer)],
  });
  await confirm('Solve', await walletClient.writeContract(request), onTx);
}

export async function depositToBank(amount: bigint, onTx: OnTx) {
  await ensureAllowance(bank.address, amount, onTx);
  const { request } = await publicClient.simulateContract({
    ...bank,
    account: you,
    functionName: 'deposit',
    args: [amount],
  });
  await confirm('Deposit', await walletClient.writeContract(request), onTx);
}

export async function withdrawFromBank(amount: bigint, onTx: OnTx) {
  const { request } = await publicClient.simulateContract({
    ...bank,
    account: you,
    functionName: 'withdraw',
    args: [amount],
  });
  await confirm('Withdraw', await walletClient.writeContract(request), onTx);
}

export async function sendInBank(to: Address, amount: bigint, onTx: OnTx) {
  const { request } = await publicClient.simulateContract({
    ...bank,
    account: you,
    functionName: 'transfer',
    args: [to, amount],
  });
  await confirm('Bank transfer', await walletClient.writeContract(request), onTx);
}

export async function listOffer(amount: bigint, priceWei: bigint, onTx: OnTx) {
  await ensureAllowance(market.address, amount, onTx);
  const { request } = await publicClient.simulateContract({
    ...market,
    account: you,
    functionName: 'createOffer',
    args: [amount, priceWei],
  });
  await confirm('List offer', await walletClient.writeContract(request), onTx);
}

export async function buyOffer(offer: Offer, onTx: OnTx) {
  const { request } = await publicClient.simulateContract({
    ...market,
    account: you,
    functionName: 'buy',
    args: [offer.id],
    value: offer.priceWei,
  });
  await confirm('Buy', await walletClient.writeContract(request), onTx);
}

export async function cancelOffer(id: bigint, onTx: OnTx) {
  const { request } = await publicClient.simulateContract({
    ...market,
    account: you,
    functionName: 'cancelOffer',
    args: [id],
  });
  await confirm('Cancel offer', await walletClient.writeContract(request), onTx);
}

export async function withdrawProceeds(onTx: OnTx) {
  const { request } = await publicClient.simulateContract({
    ...market,
    account: you,
    functionName: 'withdrawProceeds',
  });
  await confirm('Withdraw proceeds', await walletClient.writeContract(request), onTx);
}
