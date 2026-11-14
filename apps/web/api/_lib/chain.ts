// viem implementation of ChainPort: the server's view of the blockchain.
import { createPublicClient, createWalletClient, http, type Address, type Hex } from 'viem';
import { nonceManager, privateKeyToAccount } from 'viem/accounts';
import { durianMineAbi } from '../../shared/abis.js';
import { addressesFor } from '../../shared/networks.js';
import { VOUCHER_TYPES, voucherDomain, type MineVoucher } from '../../shared/voucher.js';
import type { ServerConfig } from './config.js';
import type { ChainPort } from './game.js';

export function createChainPort(config: ServerConfig): ChainPort {
  const chain = config.network.chain;
  const addresses = addressesFor(chain.id);
  if (!addresses) throw new Error(`No deployment for chain ${chain.id}. Deploy, then run \`npm run sync\`.`);

  const transport = http(config.rpcUrl);
  const publicClient = createPublicClient({ chain, transport });
  const signer = privateKeyToAccount(config.voucherSignerKey);
  // nonceManager hands out nonces locally, so two drips from one function instance don't collide.
  const faucet = createWalletClient({ chain, transport, account: privateKeyToAccount(config.faucetKey, { nonceManager }) });
  const mine = { address: addresses.DurianMine, abi: durianMineAbi } as const;

  return {
    itemsAddress: addresses.DavaoItems,
    ethBalance: (address: Address) => publicClient.getBalance({ address }),
    nextMineAt: (spotId: number, miner: Address) =>
      publicClient.readContract({ ...mine, functionName: 'nextMineAt', args: [BigInt(spotId), miner] }),
    sendDrip: (to: Address, value: bigint) => faucet.sendTransaction({ to, value }),
    signVoucher: (message: MineVoucher) =>
      signer.signTypedData({
        domain: voucherDomain(chain.id, addresses.DurianMine),
        types: VOUCHER_TYPES,
        primaryType: 'MineVoucher',
        message,
      }),
    receipt: async (hash: Hex) => {
      try {
        return await publicClient.waitForTransactionReceipt({ hash, timeout: 8_000 });
      } catch {
        return null;
      }
    },
  };
}

/** For a startup sanity check: the key we sign with must be the one the contract trusts. */
export async function signerMatchesContract(config: ServerConfig): Promise<boolean> {
  const addresses = addressesFor(config.network.chain.id);
  if (!addresses) return false;
  const client = createPublicClient({ chain: config.network.chain, transport: http(config.rpcUrl) });
  const onChain = await client.readContract({ address: addresses.DurianMine, abi: durianMineAbi, functionName: 'signer' });
  return onChain.toLowerCase() === privateKeyToAccount(config.voucherSignerKey).address.toLowerCase();
}
