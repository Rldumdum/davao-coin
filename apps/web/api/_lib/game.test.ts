import { describe, expect, it } from 'vitest';
import {
  encodeAbiParameters,
  encodeEventTopics,
  recoverTypedDataAddress,
  zeroAddress,
  type Address,
  type Hex,
  type TransactionReceipt,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { davaoItemsAbi } from '../../shared/abis.js';
import { ITEM, STAMINA } from '../../shared/rules.js';
import { VOUCHER_TYPES, voucherDomain, type MineVoucher } from '../../shared/voucher.js';
import { ApiFailure, eat, requestMine, startSession, type ChainPort, type Deps } from './game.js';
import { MemoryStore } from './store.js';

const PLAYER = '0x00000000000000000000000000000000000000aa' as Address;
const ITEMS = '0x00000000000000000000000000000000000000c0' as Address;
const MINE = '0x00000000000000000000000000000000000000d0' as Address;
const signer = privateKeyToAccount('0x0000000000000000000000000000000000000000000000000000000000a11ce1');

function setup(overrides: Partial<ChainPort> = {}) {
  let now = 1_800_000_000_000;
  let nextId = 1n;
  const drips: { to: Address; wei: bigint }[] = [];
  const receipts = new Map<string, TransactionReceipt>();
  const chain: ChainPort = {
    itemsAddress: ITEMS,
    ethBalance: async () => 0n,
    nextMineAt: async () => 0n,
    sendDrip: async (to, wei) => {
      drips.push({ to, wei });
      return `0x${'d'.repeat(64)}` as Hex;
    },
    signVoucher: (message: MineVoucher) =>
      signer.signTypedData({ domain: voucherDomain(31337, MINE), types: VOUCHER_TYPES, primaryType: 'MineVoucher', message }),
    receipt: async (hash) => receipts.get(hash) ?? null,
    ...overrides,
  };
  const deps: Deps = {
    store: new MemoryStore(),
    chain,
    config: {
      dripWei: 1000n,
      limits: { swingsPerIpPerMinute: 40, swingsPerAddressPerDay: 3000, dripsPerIpPerDay: 2, dripsPerDay: 100 },
    },
    now: () => now,
    randomId: () => nextId++,
  };
  return { deps, drips, receipts, advance: (ms: number) => (now += ms) };
}

/** A receipt in which `from` burned `value` of item `id` on DavaoItems. */
function burnReceipt(from: Address, id: number, value: bigint, contract: Address = ITEMS): TransactionReceipt {
  return {
    status: 'success',
    logs: [
      {
        address: contract,
        topics: encodeEventTopics({ abi: davaoItemsAbi, eventName: 'TransferSingle', args: { operator: from, from, to: zeroAddress } }),
        data: encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [BigInt(id), value]),
      },
    ],
  } as unknown as TransactionReceipt;
}

const failure = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApiFailure) return e;
    throw e;
  }
  throw new Error('expected an ApiFailure');
};

describe('session', () => {
  it('creates the player at full stamina and drips gas to an empty wallet once', async () => {
    const { deps, drips } = setup();
    const first = await startSession(deps, PLAYER, 'ip1');
    expect(first.stamina.value).toBe(STAMINA.max);
    expect(first.drip?.amountWei).toBe('1000');
    expect(drips).toHaveLength(1);

    const second = await startSession(deps, PLAYER, 'ip1');
    expect(second.drip).toBeNull();
    expect(second.dripRefused).toMatch(/already/);
  });

  it('does not drip to a wallet that can already pay for gas', async () => {
    const { deps, drips } = setup({ ethBalance: async () => 600n });
    expect((await startSession(deps, PLAYER, 'ip1')).drip).toBeNull();
    expect(drips).toHaveLength(0);
  });

  it('caps drips per IP, so a script making fresh wallets drains nothing', async () => {
    const { deps } = setup();
    const wallet = (n: number) => `0x${n.toString(16).padStart(40, '0')}` as Address;
    expect((await startSession(deps, wallet(1), 'ip1')).drip).not.toBeNull();
    expect((await startSession(deps, wallet(2), 'ip1')).drip).not.toBeNull();
    const third = await startSession(deps, wallet(3), 'ip1');
    expect(third.drip).toBeNull();
    expect(third.dripRefused).toMatch(/network/);
    expect((await startSession(deps, wallet(4), 'ip2')).drip).not.toBeNull();
  });
});

describe('mine voucher', () => {
  it('signs a voucher only the signer key could have made, bound to player and spot', async () => {
    const { deps } = setup();
    const res = await requestMine(deps, PLAYER, 2, 'ip1');
    const message = {
      miner: PLAYER,
      spotId: 2n,
      voucherId: BigInt(res.voucher.voucherId),
      deadline: BigInt(res.voucher.deadline),
    };
    const recovered = await recoverTypedDataAddress({
      domain: voucherDomain(31337, MINE),
      types: VOUCHER_TYPES,
      primaryType: 'MineVoucher',
      message,
      signature: res.voucher.signature,
    });
    expect(recovered).toBe(signer.address);
    expect(res.stamina.value).toBe(STAMINA.max - STAMINA.mineCost);
  });

  it('refuses when out of stamina, and stamina regenerates over time', async () => {
    const { deps, advance } = setup();
    const swings = Math.floor(STAMINA.max / STAMINA.mineCost);
    for (let i = 0; i < swings; i++) await requestMine(deps, PLAYER, 0, 'ip1');
    const tired = await failure(requestMine(deps, PLAYER, 0, 'ip1'));
    expect(tired.code).toBe('too_tired');
    expect(tired.stamina).toBeDefined();

    advance(((STAMINA.mineCost / STAMINA.regenPerSec) * 1000) | 0);
    await expect(requestMine(deps, PLAYER, 0, 'ip1')).resolves.toBeTruthy();
  });

  it('does not spend stamina while the vein is cooling down on-chain', async () => {
    const { deps } = setup({ nextMineAt: async () => 1_800_000_030n });
    const err = await failure(requestMine(deps, PLAYER, 0, 'ip1'));
    expect(err.code).toBe('cooling_down');
    expect((await deps.store.ensurePlayer(PLAYER, Date.now())).value).toBe(STAMINA.max);
  });

  it('rate-limits per IP', async () => {
    const { deps } = setup();
    deps.config.limits.swingsPerIpPerMinute = 3;
    const wallet = (n: number) => `0x${n.toString(16).padStart(40, '0')}` as Address;
    for (let i = 1; i <= 3; i++) await requestMine(deps, wallet(i), 0, 'ip1');
    expect((await failure(requestMine(deps, wallet(9), 0, 'ip1'))).code).toBe('rate_limited');
  });

  it('rejects unknown spots', async () => {
    const { deps } = setup();
    expect((await failure(requestMine(deps, PLAYER, 99, 'ip1'))).status).toBe(400);
    expect((await failure(requestMine(deps, PLAYER, '1', 'ip1'))).status).toBe(400);
  });
});

describe('eat', () => {
  const hash = (c: string) => `0x${c.repeat(64)}`;

  it('credits stamina for fruit burned on-chain, once per transaction', async () => {
    const { deps, receipts } = setup();
    for (let i = 0; i < 5; i++) await requestMine(deps, PLAYER, 0, 'ip1'); // 100 - 60 = 40
    receipts.set(hash('a'), burnReceipt(PLAYER, ITEM.DURIAN_FRUIT, 1n));

    const res = await eat(deps, PLAYER, hash('a'));
    expect(res.stamina.value).toBe(100); // 40 + 60, capped at max
    expect((await failure(eat(deps, PLAYER, hash('a')))).code).toBe('already_eaten');
  });

  it('ignores burns of non-fruit, burns by someone else, and other contracts', async () => {
    const { deps, receipts } = setup();
    const other = '0x00000000000000000000000000000000000000bb' as Address;
    receipts.set(hash('1'), burnReceipt(PLAYER, ITEM.COPPER_ORE, 1n));
    receipts.set(hash('2'), burnReceipt(other, ITEM.DURIAN_FRUIT, 1n));
    receipts.set(hash('3'), burnReceipt(PLAYER, ITEM.DURIAN_FRUIT, 1n, '0x00000000000000000000000000000000000000ff'));
    for (const c of ['1', '2', '3']) expect((await failure(eat(deps, PLAYER, hash(c)))).code).toBe('not_a_meal');
    expect((await failure(eat(deps, PLAYER, hash('9')))).code).toBe('not_a_meal'); // no receipt at all
  });
});
