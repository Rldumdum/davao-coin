// Infrastructure: how the browser reaches the blockchain.
//
// Network: VITE_NETWORK picks it ('local' anvil by default, 'base-sepolia' in production).
//
// Wallet: a SESSION WALLET. The first visit generates a private key and keeps it in this
// browser's localStorage; the game API's faucet sends it a little gas money. No popups, which
// matters for a game that sends a transaction per swing.
// Trade-off: anything running on this page (an XSS bug, a malicious extension) could read the
// key. Acceptable for testnet play money; for real value you'd use a real wallet (wagmi +
// MetaMask) or a smart-account session key with limited permissions.
import { createPublicClient, createWalletClient, http, type Address, type Hex } from 'viem';
import { generatePrivateKey, mnemonicToAccount, privateKeyToAccount } from 'viem/accounts';
import { addressesFor, networkByName, type Addresses } from '../../shared/networks';

export const network = networkByName(import.meta.env.VITE_NETWORK);
export const RPC_URL: string = import.meta.env.VITE_RPC_URL ?? network.rpcUrl;
const transport = http(RPC_URL);

const deployed = addressesFor(network.chain.id);
/** False when nothing is deployed (and synced) for this network yet; the UI shows setup help. */
export const IS_DEPLOYED = deployed !== null;
export const ADDRESSES: Addresses = deployed ?? (new Proxy({}, { get: () => '0x0000000000000000000000000000000000000000' }) as Addresses);

/* --------------------------------------------------------- session wallet */

const KEY_STORAGE = `davao-session-key:${network.chain.id}`;

function loadOrCreateKey(): Hex {
  try {
    const saved = localStorage.getItem(KEY_STORAGE);
    if (saved && /^0x[0-9a-f]{64}$/i.test(saved)) return saved as Hex;
    const key = generatePrivateKey();
    localStorage.setItem(KEY_STORAGE, key);
    return key;
  } catch {
    // Storage blocked (private mode): a key for this page load only.
    return generatePrivateKey();
  }
}

export const you = privateKeyToAccount(loadOrCreateKey());

/** Lets a player back up their session wallet (it only holds testnet assets). */
export function exportSessionKey(): string | null {
  try {
    return localStorage.getItem(KEY_STORAGE);
  } catch {
    return null;
  }
}

export const publicClient = createPublicClient({ chain: network.chain, transport });
export const walletClient = createWalletClient({ account: you, chain: network.chain, transport });

/* ---------------------------------------------------------- sample people */

export interface Person {
  readonly name: string;
  readonly address: Address;
}

// anvil's public test mnemonic: DeployLocal seeds these accounts. They don't exist on testnets.
const ANVIL_MNEMONIC = 'test test test test test test test test test test test junk';

export const SAMPLE_PEOPLE: readonly Person[] = network.hasSamplePeople
  ? (
      [
        ['Inday', 1],
        ['Dodong', 2],
        ['Nonoy', 3],
        ['Ging', 4],
      ] as const
    ).map(([name, addressIndex]) => ({ name, address: mnemonicToAccount(ANVIL_MNEMONIC, { addressIndex }).address }))
  : [];

export function nameOf(address: Address): string {
  if (address.toLowerCase() === you.address.toLowerCase()) return 'You';
  const person = SAMPLE_PEOPLE.find((p) => p.address.toLowerCase() === address.toLowerCase());
  return person?.name ?? `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function explorerTx(hash: string): string | null {
  return network.explorer ? `${network.explorer}/tx/${hash}` : null;
}
