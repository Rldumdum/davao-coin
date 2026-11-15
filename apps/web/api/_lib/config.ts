// Server configuration from environment variables. Everything secret lives here and only here.
// Nothing in this folder is ever bundled into the browser (Vite only bundles src/).
import type { Hex } from 'viem';
import { mnemonicToAccount } from 'viem/accounts';
import { networkByName, type Network } from '../../shared/networks.js';

export interface ServerConfig {
  network: Network;
  rpcUrl: string;
  /** Signs mining vouchers. Its ADDRESS is what DurianMine.signer() must return. */
  voucherSignerKey: Hex;
  /** Pays the gas-money drips to new session wallets. */
  faucetKey: Hex;
  dripWei: bigint;
  supabase: { url: string; serviceRoleKey: string } | null;
  ipHashSalt: string;
  limits: {
    /** Vouchers one IP can get per minute (a human swings at most ~1 per 1.2 s). */
    swingsPerIpPerMinute: number;
    swingsPerAddressPerDay: number;
    dripsPerIpPerDay: number;
    dripsPerDay: number;
  };
}

// anvil's public test mnemonic. These keys are known to everyone, which is fine on a local chain
// and the reason they are refused everywhere else.
const ANVIL_MNEMONIC = 'test test test test test test test test test test test junk';
const anvilKey = (index: number): Hex => {
  const key = mnemonicToAccount(ANVIL_MNEMONIC, { addressIndex: index }).getHdKey().privateKey;
  return `0x${Buffer.from(key!).toString('hex')}`;
};

/** Env values pasted into dashboards or piped from shells often carry stray whitespace/newlines. */
const env = (name: string): string | undefined => process.env[name]?.trim() || undefined;

function required(name: string): string {
  const v = env(name);
  if (!v) throw new Error(`Missing environment variable ${name}. See apps/web/.env.example.`);
  return v;
}

let cached: ServerConfig | null = null;

export function loadConfig(): ServerConfig {
  if (cached) return cached;
  const network = networkByName(env('NETWORK') ?? env('VITE_NETWORK'));
  const local = network.name === 'local';

  const supabaseUrl = env('SUPABASE_URL');
  const supabaseKey = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!local && !(supabaseUrl && supabaseKey)) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required outside the local network.');
  }

  cached = {
    network,
    rpcUrl: env('RPC_URL') ?? network.rpcUrl,
    voucherSignerKey: (local ? (env('VOUCHER_SIGNER_KEY') ?? anvilKey(9)) : required('VOUCHER_SIGNER_KEY')) as Hex,
    faucetKey: (local ? (env('FAUCET_PRIVATE_KEY') ?? anvilKey(0)) : required('FAUCET_PRIVATE_KEY')) as Hex,
    dripWei: BigInt(env('FAUCET_DRIP_WEI') ?? (local ? '50000000000000000' : '200000000000000')), // 0.05 / 0.0002 ETH
    supabase: supabaseUrl && supabaseKey ? { url: supabaseUrl, serviceRoleKey: supabaseKey } : null,
    ipHashSalt: local ? (env('IP_HASH_SALT') ?? 'local-dev') : required('IP_HASH_SALT'),
    limits: {
      swingsPerIpPerMinute: Number(env('LIMIT_SWINGS_PER_IP_PER_MINUTE') ?? 40),
      swingsPerAddressPerDay: Number(env('LIMIT_SWINGS_PER_ADDRESS_PER_DAY') ?? 3000),
      dripsPerIpPerDay: Number(env('LIMIT_DRIPS_PER_IP_PER_DAY') ?? 5),
      dripsPerDay: Number(env('LIMIT_DRIPS_PER_DAY') ?? 300),
    },
  };
  return cached;
}
