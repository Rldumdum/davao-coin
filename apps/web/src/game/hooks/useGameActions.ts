// What happens when the player does something: interact, finish a swing, eat, trade.
// Each action = local feedback first (animation, optimistic stamina), then the API/chain.
import { useCallback, type MutableRefObject } from 'react';
import type { StaminaJson } from '../../../shared/api';
import { describeError, formatDurian } from '../../lib/format';
import { ApiCallError } from '../../services/api';
import { eat, mine, trade, type Bundle, type GameState, type TxRecord } from '../../services/game';
import type { Game, Target } from '../engine/Game';
import { sfx, unlockAudio } from '../engine/sfx';
import type { LogEntry } from '../hud/Hud';
import { MINE_SPOTS, STAMINA, itemInfo, type ItemId, type MerchantKey } from '../world-data';

interface Deps {
  gameRef: MutableRefObject<Game | null>;
  stateRef: MutableRefObject<GameState | null>;
  refresh(): Promise<void>;
  stamina: { valueRef: MutableRefObject<number>; sync(s: StaminaJson): void; spend(cost: number): void };
  log: { push(e: Omit<LogEntry, 'id'>): void; track<T>(work: () => Promise<T>): Promise<T>; showToast(text: string): void };
  openTrade(key: MerchantKey): void;
  setTradeSteps(update: (steps: string[]) => string[]): void;
}

const spotName = (spotId: number) => MINE_SPOTS.find((s) => s.spotId === spotId)?.name ?? `Spot ${spotId}`;

export function useGameActions(d: Deps) {
  const { gameRef, stateRef, refresh, stamina, log } = d;

  const onTx = useCallback(
    (label: string) => (tx: TxRecord) => log.push({ text: `${label}: ${tx.step}`, hash: tx.hash, block: tx.block, tone: 'ok' }),
    [log],
  );

  /** The server sometimes corrects our stamina guess (e.g. "too tired"); listen to it. */
  const handleApiError = useCallback(
    (err: unknown, label: string) => {
      if (err instanceof ApiCallError && err.body.stamina) stamina.sync(err.body.stamina);
      log.push({ text: `${label}: ${describeError(err)}`, tone: 'bad' });
      return err instanceof ApiCallError ? err.body.message : describeError(err);
    },
    [stamina, log],
  );

  const interact = useCallback(
    (t: Target) => {
      const game = gameRef.current;
      const s = stateRef.current;
      if (!game || !s) return;
      unlockAudio();
      if (t.kind === 'villager') return game.villagerTalk(t.index);
      if (t.kind === 'merchant') {
        sfx.open();
        d.setTradeSteps(() => []);
        return d.openTrade(t.key);
      }
      const spot = s.spots.find((sp) => sp.spotId === t.spotId);
      const left = spot ? Math.ceil(spot.readyAt - Date.now() / 1000) : 0;
      if (left > 0) {
        sfx.error();
        return game.floatText({ spotId: t.spotId }, `Regrowing… ${left}s`, 'info');
      }
      if (stamina.valueRef.current < STAMINA.mineCost) {
        sfx.error();
        game.floatText('player', 'Too tired!', 'bad');
        return log.showToast('Out of stamina. Eat fruit (keys 1–3) or rest a bit. Aling Nena sells fruit.');
      }
      game.startMining(t.spotId);
    },
    [gameRef, stateRef, stamina, log, d],
  );

  const swingDone = useCallback(
    (spotId: number) => {
      const game = gameRef.current;
      if (!game) return;
      stamina.spend(STAMINA.mineCost);
      // Show the cooldown right away; the next chain poll confirms it.
      const s = stateRef.current;
      const spot = s?.spots.find((sp) => sp.spotId === spotId);
      if (s && spot) {
        const readyAt = new Map(s.spots.map((sp) => [sp.spotId, sp.readyAt]));
        readyAt.set(spotId, Math.floor(Date.now() / 1000) + spot.cooldown);
        game.setSpotReadyAt(readyAt);
      }
      void log
        .track(() => mine(spotId, onTx(`Mined ${spotName(spotId)}`)))
        .then((r) => {
          stamina.sync(r.stamina);
          sfx.coin();
          game.floatText({ spotId }, `+${formatDurian(r.durian)} DURIAN`, 'gold');
          game.floatText({ spotId }, `+${r.oreAmount.toString()} ${itemInfo(r.oreId).name}`, 'ore', 350);
        })
        .catch((err: unknown) => {
          sfx.error();
          const message = handleApiError(err, 'Mine failed');
          game.floatText({ spotId }, message.length < 28 ? message : 'Failed', 'bad');
        })
        .finally(() => void refresh());
    },
    [gameRef, stateRef, stamina, log, onTx, handleApiError, refresh],
  );

  const eatFruit = useCallback(
    (id: ItemId) => {
      const info = itemInfo(id);
      if ((stateRef.current?.items[id] ?? 0n) === 0n) return log.showToast(`No ${info.name} in your bag.`);
      if (stamina.valueRef.current >= STAMINA.max) return log.showToast("You're not hungry.");
      void log
        .track(() => eat(id, onTx(`Ate ${info.name}`)))
        .then((s) => {
          stamina.sync(s);
          sfx.eat();
          gameRef.current?.floatText('player', `+${info.stamina} stamina`, 'ore');
        })
        .catch((err: unknown) => handleApiError(err, 'Eat failed'))
        .finally(() => void refresh());
    },
    [gameRef, stateRef, stamina, log, onTx, handleApiError, refresh],
  );

  const tradeWith = useCallback(
    async (key: MerchantKey, give: Bundle, take: Bundle) => {
      const merchant = stateRef.current?.merchants[key];
      if (!merchant) return false;
      d.setTradeSteps(() => []);
      try {
        await log.track(() =>
          trade(merchant, give, take, (tx) => {
            d.setTradeSteps((st) => [...st, `${tx.step} · block ${tx.block} · ${tx.hash.slice(0, 10)}…`]);
            onTx(`Trade with ${merchant.name}`)(tx);
          }),
        );
        return true;
      } catch (err) {
        const message = handleApiError(err, 'Trade failed');
        d.setTradeSteps((st) => [...st, `Failed: ${message}`]);
        return false;
      } finally {
        void refresh();
      }
    },
    [stateRef, log, onTx, handleApiError, refresh, d],
  );

  return { interact, swingDone, eatFruit, tradeWith };
}
