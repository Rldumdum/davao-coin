// Persistence for the game server, behind an interface so the logic doesn't care where it lives:
//   - MemoryStore: local dev and tests. Resets when the dev server restarts.
//   - SupabaseStore (store-supabase.ts): production.
import { STAMINA, staminaAt } from '../../shared/rules.js';
import type { StaminaJson } from '../../shared/api.js';

export interface SwingRecord {
  address: string;
  spotId: number;
  voucherId: string;
  ipHash: string;
}

export interface DripRecord {
  address: string;
  ipHash: string;
  txHash: string;
  amountWei: string;
}

export interface MealRecord {
  txHash: string;
  address: string;
  itemId: number;
  stamina: number;
}

export interface CountFilter {
  address?: string;
  ipHash?: string;
  sinceMs: number;
}

export interface Store {
  /** Creates the player with full stamina if new; returns their stamina either way. */
  ensurePlayer(address: string, nowMs: number): Promise<StaminaJson>;
  /**
   * Atomically: regenerate, check, deduct. Returns null if there isn't enough.
   * Atomic matters: two requests at once must not both spend the same stamina.
   */
  spendStamina(address: string, cost: number, nowMs: number): Promise<StaminaJson | null>;
  /** Records the meal and credits stamina, once per tx hash. Null if that tx was already eaten. */
  eat(meal: MealRecord, nowMs: number): Promise<StaminaJson | null>;
  recordSwing(swing: SwingRecord, nowMs: number): Promise<void>;
  countSwings(filter: CountFilter): Promise<number>;
  recordDrip(drip: DripRecord, nowMs: number): Promise<void>;
  countDrips(filter: CountFilter): Promise<number>;
}

/* ------------------------------------------------------------- memory */

interface Timed {
  at: number;
}

export class MemoryStore implements Store {
  private players = new Map<string, StaminaJson>();
  private swings: (SwingRecord & Timed)[] = [];
  private drips: (DripRecord & Timed)[] = [];
  private meals = new Set<string>();

  async ensurePlayer(address: string, nowMs: number) {
    let p = this.players.get(address);
    if (!p) {
      p = { value: STAMINA.max, at: nowMs };
      this.players.set(address, p);
    }
    return { ...p };
  }

  // JavaScript is single-threaded and nothing here awaits mid-update, so this is atomic.
  async spendStamina(address: string, cost: number, nowMs: number) {
    const p = await this.ensurePlayer(address, nowMs);
    const current = staminaAt(p.value, p.at, nowMs);
    if (current < cost) return null;
    const next = { value: current - cost, at: nowMs };
    this.players.set(address, next);
    return { ...next };
  }

  async eat(meal: MealRecord, nowMs: number) {
    if (this.meals.has(meal.txHash)) return null;
    this.meals.add(meal.txHash);
    const p = await this.ensurePlayer(meal.address, nowMs);
    const next = { value: Math.min(STAMINA.max, staminaAt(p.value, p.at, nowMs) + meal.stamina), at: nowMs };
    this.players.set(meal.address, next);
    return { ...next };
  }

  async recordSwing(swing: SwingRecord, nowMs: number) {
    this.swings.push({ ...swing, at: nowMs });
  }

  async countSwings(f: CountFilter) {
    return this.swings.filter((s) => matches(s, f)).length;
  }

  async recordDrip(drip: DripRecord, nowMs: number) {
    this.drips.push({ ...drip, at: nowMs });
  }

  async countDrips(f: CountFilter) {
    return this.drips.filter((d) => matches(d, f)).length;
  }
}

function matches(r: { address: string; ipHash: string; at: number }, f: CountFilter) {
  return r.at >= f.sinceMs && (f.address === undefined || r.address === f.address) && (f.ipHash === undefined || r.ipHash === f.ipHash);
}
