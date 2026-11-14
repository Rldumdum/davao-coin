// Production store: Supabase Postgres, reached ONLY from the server with the service-role key.
// Every table has RLS enabled and no policies, so the anon key (if it ever leaked into a
// browser) can read and write nothing. See supabase/migrations/.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { STAMINA } from '../../shared/rules.js';
import type { StaminaJson } from '../../shared/api.js';
import type { CountFilter, DripRecord, MealRecord, Store, SwingRecord } from './store.js';

interface StaminaRow {
  ok?: boolean;
  value: number;
  at: string;
}

const toJson = (row: StaminaRow): StaminaJson => ({ value: Number(row.value), at: new Date(row.at).getTime() });

export class SupabaseStore implements Store {
  private db: SupabaseClient;

  constructor(url: string, serviceRoleKey: string) {
    this.db = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  }

  private async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await this.db.rpc(fn, args);
    if (error) throw new Error(`${fn}: ${error.message}`);
    return data as T;
  }

  async ensurePlayer(address: string) {
    const [row] = await this.rpc<StaminaRow[]>('game_ensure_player', { p_address: address, p_max: STAMINA.max });
    return toJson(row!);
  }

  // The read-check-write happens inside one Postgres function holding a row lock,
  // so concurrent requests can't both spend the same stamina.
  async spendStamina(address: string, cost: number) {
    const [row] = await this.rpc<StaminaRow[]>('game_spend_stamina', {
      p_address: address,
      p_cost: cost,
      p_max: STAMINA.max,
      p_regen: STAMINA.regenPerSec,
    });
    return row?.ok ? toJson(row) : null;
  }

  async eat(meal: MealRecord) {
    const [row] = await this.rpc<StaminaRow[]>('game_eat', {
      p_tx_hash: meal.txHash,
      p_address: meal.address,
      p_item_id: meal.itemId,
      p_amount: meal.stamina,
      p_max: STAMINA.max,
      p_regen: STAMINA.regenPerSec,
    });
    return row?.ok ? toJson(row) : null;
  }

  async recordSwing(s: SwingRecord, nowMs: number) {
    const { error } = await this.db.from('swings').insert({
      address: s.address,
      spot_id: s.spotId,
      voucher_id: s.voucherId,
      ip_hash: s.ipHash,
      created_at: new Date(nowMs).toISOString(),
    });
    if (error) throw new Error(`recordSwing: ${error.message}`);
  }

  async countSwings(f: CountFilter) {
    return this.count('swings', f);
  }

  async recordDrip(d: DripRecord, nowMs: number) {
    const { error } = await this.db.from('faucet_drips').insert({
      address: d.address,
      ip_hash: d.ipHash,
      tx_hash: d.txHash,
      amount_wei: d.amountWei,
      created_at: new Date(nowMs).toISOString(),
    });
    if (error) throw new Error(`recordDrip: ${error.message}`);
  }

  async countDrips(f: CountFilter) {
    return this.count('faucet_drips', f);
  }

  private async count(table: string, f: CountFilter) {
    let q = this.db.from(table).select('*', { count: 'exact', head: true }).gte('created_at', new Date(f.sinceMs).toISOString());
    if (f.address) q = q.eq('address', f.address);
    if (f.ipHash) q = q.eq('ip_hash', f.ipHash);
    const { count, error } = await q;
    if (error) throw new Error(`count ${table}: ${error.message}`);
    return count ?? 0;
  }
}
