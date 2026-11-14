// What the game world LOOKS like: characters, merchants, villagers, layout.
// The rules (items, mine spots, stamina) live in shared/rules.ts so the API uses the same numbers.

export * from '../../shared/rules.js';
import type { ContractName } from '../../shared/networks.js';

export const SWING_SECONDS = 1.2;

/* ------------------------------------------------------------- characters */

export type Hat = 'none' | 'salakot' | 'hardhat' | 'cap' | 'bandana' | 'bun';

export interface Look {
  skin: string;
  hair: string;
  shirt: string;
  pants: string;
  hat: Hat;
  hatColor?: string;
  apron?: string;
  mustache?: boolean;
  backpack?: boolean;
  pickaxe?: boolean;
  scale?: number;
}

export const PLAYER_LOOK: Look = {
  skin: '#b97a4f',
  hair: '#1d140e',
  shirt: '#2e6f5e',
  pants: '#2b3346',
  hat: 'hardhat',
  hatColor: '#f2b632',
  backpack: true,
  pickaxe: true,
};

/* --------------------------------------------------------------- merchants */

export type MerchantKey = 'nena' | 'berto' | 'jun';
type AddressKey = ContractName;

export interface MerchantInfo {
  key: MerchantKey;
  addressKey: AddressKey;
  name: string;
  title: string;
  /** Where the merchant stands (behind the counter). */
  x: number;
  z: number;
  awning: [string, string];
  look: Look;
  lines: { greet: string[]; unfair: string; fair: string; generous: string; thanks: string[]; empty: string };
}

export const MERCHANTS: readonly MerchantInfo[] = [
  {
    key: 'nena',
    addressKey: 'MerchantNena',
    name: 'Aling Nena',
    title: 'Fruit Stall',
    x: 16,
    z: -7,
    awning: ['#e0533d', '#f6ecd2'],
    look: { skin: '#a8714a', hair: '#2a1d16', shirt: '#d98fb0', pants: '#4b3b5c', hat: 'bun', apron: '#f4efe1' },
    lines: {
      greet: ['Fresh from Calinan, suki!', 'Durian, pomelo, mangosteen. Tikman mo!', 'Tired from mining? Eat something.'],
      unfair: "Ay, that's too little, suki.",
      fair: "Sige, that's fair. Deal!",
      generous: "You're giving me extra! Sure ka?",
      thanks: ['Salamat, suki! Balik ka ha.', 'Enjoy! Wash your hands after the durian.'],
      empty: 'Put something on the table, iho.',
    },
  },
  {
    key: 'berto',
    addressKey: 'MerchantBerto',
    name: 'Mang Berto',
    title: 'Blacksmith',
    x: 18.5,
    z: 3.5,
    awning: ['#3d5a80', '#e8e1cf'],
    look: { skin: '#8d5a3b', hair: '#3a3a3a', shirt: '#6b4f3a', pants: '#2b2b2b', hat: 'bandana', hatColor: '#b33a3a', apron: '#4a3426', mustache: true, scale: 1.08 },
    lines: {
      greet: ['Bring me ore, I pay in DURIAN.', 'A good pickaxe pays for itself.', 'Gold from the deep seam? I want it.'],
      unfair: 'Hindi pwede. That steel took me all week.',
      fair: 'Hmm. Fair enough. Deal.',
      generous: 'Generous! I will not argue.',
      thanks: ['Good doing business.', 'Swing it hard, the mountain is patient.'],
      empty: 'Show me what you have.',
    },
  },
  {
    key: 'jun',
    addressKey: 'MerchantJun',
    name: 'Kuya Jun',
    title: 'Money Changer',
    x: 14.5,
    z: 14,
    awning: ['#2f7a45', '#f2c14e'],
    look: { skin: '#c48b5c', hair: '#141414', shirt: '#f2f2f2', pants: '#1f2a44', hat: 'cap', hatColor: '#2f7a45' },
    lines: {
      greet: ['ETH to DURIAN, DURIAN to ETH. Best rates in the barangay.', 'I collect Apo Crystals, if you find any.', 'No fake coins, ha. Everything is on-chain.'],
      unfair: 'The rate is the rate, boss.',
      fair: 'Rate checks out. Deal.',
      generous: 'Keep the change? Okay, thank you boss.',
      thanks: ['Pleasure, boss.', 'Come back when the market moves.'],
      empty: 'What are we changing today?',
    },
  },
];

/* --------------------------------------------------------------- villagers */

export interface VillagerInfo {
  name: string;
  look: Look;
  lines: string[];
}

/** The sample people from DeployLocal, walking around the plaza. */
export const VILLAGERS: readonly VillagerInfo[] = [
  {
    name: 'Inday',
    look: { skin: '#b57a50', hair: '#24170f', shirt: '#f2c14e', pants: '#3a7bd5', hat: 'none' },
    lines: ['The copper veins refill fast. Good for beginners.', 'I sell DURIAN on the market board too.', 'Have you tried Aling Nena\'s durian? It restores so much stamina!'],
  },
  {
    name: 'Dodong',
    look: { skin: '#8d5a3b', hair: '#1b1410', shirt: '#d64545', pants: '#3b3b3b', hat: 'salakot', hatColor: '#c9a46a' },
    lines: ['The crystal cave is up the slope, to the northeast.', 'Mang Berto pays 100 for a gold nugget.', 'Iron pickaxe first. Trust me.'],
  },
  {
    name: 'Nonoy',
    look: { skin: '#c48b5c', hair: '#0f0f0f', shirt: '#4ecdc4', pants: '#6b5b45', hat: 'cap', hatColor: '#222222', scale: 0.86 },
    lines: ['Kuya Jun gives 90k DURIAN per ETH. Not bad.', 'My lolo says the mountain never runs out.', 'Race you to the statue!'],
  },
  {
    name: 'Ging',
    look: { skin: '#a8714a', hair: '#3b2416', shirt: '#7b5ea7', pants: '#2b3a55', hat: 'none' },
    lines: ['Every swing is a transaction. Every one is on the chain forever.', 'Happy Kadayawan!', 'Kuya Jun buys Apo Crystals for more than Berto does.'],
  },
];

/* ---------------------------------------------------------------- layout */

export const SPAWN = { x: 0, z: 11, heading: Math.PI } as const;
export const WORLD_RADIUS = 47;

export interface Hut {
  x: number;
  z: number;
  rot: number;
}

export const HUTS: readonly Hut[] = [
  { x: -19, z: -5, rot: 0.6 },
  { x: -22, z: 7, rot: 1.4 },
  { x: -13, z: 18, rot: 2.3 },
  { x: 3, z: 25, rot: 3.1 },
];
