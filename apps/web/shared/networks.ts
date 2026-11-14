// Which chains the app can run on, and where each one's contracts live.
// Pure data + functions: no import.meta.env or process.env here, because both the browser
// (Vite) and the API (Vercel functions) import this file. Each side picks the network itself.
import type { Address, Chain } from 'viem';
import { baseSepolia, foundry } from 'viem/chains';
import { DEPLOYMENTS } from './deployments.js';

export type NetworkName = 'local' | 'base-sepolia';

export interface Network {
  name: NetworkName;
  chain: Chain;
  /** Public default RPC; override with VITE_RPC_URL (browser) or RPC_URL (server). */
  rpcUrl: string;
  explorer?: string;
  /** Sample people (Inday, Dodong...) only exist where DeployLocal seeded them. */
  hasSamplePeople: boolean;
}

export const NETWORKS: Record<NetworkName, Network> = {
  local: { name: 'local', chain: foundry, rpcUrl: 'http://127.0.0.1:8545', hasSamplePeople: true },
  'base-sepolia': {
    name: 'base-sepolia',
    chain: baseSepolia,
    rpcUrl: 'https://sepolia.base.org',
    explorer: 'https://sepolia.basescan.org',
    hasSamplePeople: false,
  },
};

export function networkByName(name: string | undefined): Network {
  const key = (name ?? 'local') as NetworkName;
  const network = NETWORKS[key];
  if (!network) throw new Error(`Unknown network "${name}". Use one of: ${Object.keys(NETWORKS).join(', ')}`);
  return network;
}

export type ContractName =
  | 'DavaoCoin'
  | 'DavaoBank'
  | 'PuzzleRewards'
  | 'DurianMarket'
  | 'DavaoItems'
  | 'DurianMine'
  | 'MerchantNena'
  | 'MerchantBerto'
  | 'MerchantJun';

export type Addresses = Record<ContractName, Address>;

/** Addresses for a chain, or null if nothing has been deployed (and synced) there yet. */
export function addressesFor(chainId: number): Addresses | null {
  const entry = (DEPLOYMENTS as Record<string, { addresses: Record<string, string> } | undefined>)[String(chainId)];
  return entry ? (entry.addresses as Addresses) : null;
}
