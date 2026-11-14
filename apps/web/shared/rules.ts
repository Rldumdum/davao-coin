// Game rules shared by the browser AND the API: item ids, what fruit restores, mine spots,
// stamina. The server enforces these numbers; the client only predicts them.
// On-chain ids here MUST match contracts/script/DeployBase.s.sol.

/* ------------------------------------------------------------------ items */

/** DavaoItems ERC-1155 ids. */
export const ITEM = {
  COPPER_ORE: 1,
  SILVER_ORE: 2,
  GOLD_NUGGET: 3,
  APO_CRYSTAL: 4,
  DURIAN_FRUIT: 10,
  POMELO: 11,
  MANGOSTEEN: 12,
  IRON_PICKAXE: 20,
  GOLD_PICKAXE: 21,
} as const;

export type ItemId = (typeof ITEM)[keyof typeof ITEM];
export type ItemKind = 'ore' | 'fruit' | 'tool';

export interface ItemInfo {
  id: ItemId;
  name: string;
  kind: ItemKind;
  description: string;
  /** Stamina restored when eaten (fruit only). */
  stamina?: number;
  /** Hotbar key for fruit. */
  hotkey?: string;
}

export const ITEMS: readonly ItemInfo[] = [
  { id: ITEM.COPPER_ORE, name: 'Copper Ore', kind: 'ore', description: 'Common ore from the lower veins. Mang Berto buys it.' },
  { id: ITEM.SILVER_ORE, name: 'Silver Ore', kind: 'ore', description: 'Cool and bright. Worth almost three copper.' },
  { id: ITEM.GOLD_NUGGET, name: 'Gold Nugget', kind: 'ore', description: 'From the deep seam. Both Berto and Kuya Jun want these.' },
  { id: ITEM.APO_CRYSTAL, name: 'Apo Crystal', kind: 'ore', description: 'Glows faintly. Only forms in the cave under the mountain.' },
  { id: ITEM.DURIAN_FRUIT, name: 'Durian', kind: 'fruit', stamina: 60, hotkey: '1', description: 'King of fruits. Smells like trouble, restores 60 stamina.' },
  { id: ITEM.MANGOSTEEN, name: 'Mangosteen', kind: 'fruit', stamina: 35, hotkey: '2', description: 'Queen of fruits. Restores 35 stamina.' },
  { id: ITEM.POMELO, name: 'Pomelo', kind: 'fruit', stamina: 20, hotkey: '3', description: 'Big, sweet, a little sour. Restores 20 stamina.' },
  { id: ITEM.IRON_PICKAXE, name: 'Iron Pickaxe', kind: 'tool', description: 'Owning one doubles everything you mine.' },
  { id: ITEM.GOLD_PICKAXE, name: 'Gold Pickaxe', kind: 'tool', description: 'Owning one triples everything you mine.' },
];

export const ALL_ITEM_IDS: readonly ItemId[] = ITEMS.map((i) => i.id);

export function itemInfo(id: number): ItemInfo {
  const info = ITEMS.find((i) => i.id === id);
  if (!info) throw new Error(`Unknown item id ${id}`);
  return info;
}

/* ---------------------------------------------------------------- mining */

export interface MineSpotInfo {
  spotId: number;
  name: string;
  ore: ItemId;
  x: number;
  z: number;
  /** Rock radius, used for collision and interaction range. */
  size: number;
}

export const MINE_SPOTS: readonly MineSpotInfo[] = [
  { spotId: 0, name: 'Copper Vein', ore: ITEM.COPPER_ORE, x: -11, z: -23, size: 1.3 },
  { spotId: 1, name: 'Copper Vein', ore: ITEM.COPPER_ORE, x: -4, z: -26, size: 1.2 },
  { spotId: 2, name: 'Silver Vein', ore: ITEM.SILVER_ORE, x: 4, z: -28, size: 1.35 },
  { spotId: 3, name: 'Silver Vein', ore: ITEM.SILVER_ORE, x: 10.5, z: -24.5, size: 1.25 },
  { spotId: 4, name: 'Gold Seam', ore: ITEM.GOLD_NUGGET, x: -2, z: -34, size: 1.5 },
  { spotId: 5, name: 'Apo Crystal Cluster', ore: ITEM.APO_CRYSTAL, x: 15, z: -35, size: 1.4 },
];

export const STAMINA = { max: 100, mineCost: 12, regenPerSec: 0.35 } as const;

/** Stamina at time nowMs, given a saved value at atMs: regenerates linearly up to the max. */
export function staminaAt(value: number, atMs: number, nowMs: number): number {
  const regen = (Math.max(0, nowMs - atMs) / 1000) * STAMINA.regenPerSec;
  return Math.min(STAMINA.max, value + regen);
}
