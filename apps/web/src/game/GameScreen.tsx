// Composition root of the game: wires the 3D engine, chain state, game server and HUD together.
// The logic lives in hooks/; this file only decides what's on screen.
import { useCallback, useEffect, useRef, useState } from 'react';
import { you } from '../lib/chain';
import { formatDurian } from '../lib/format';
import { Game, type Target } from './engine/Game';
import { sfx, unlockAudio } from './engine/sfx';
import { useGameActions } from './hooks/useGameActions';
import { useGameChain } from './hooks/useGameChain';
import { useSession } from './hooks/useSession';
import { useStamina } from './hooks/useStamina';
import { useTxLog } from './hooks/useTxLog';
import { ChainLog, Hotbar, Inventory, Minimap, Prompt, Purse, StatusBar } from './hud/Hud';
import { TradeWindow } from './hud/TradeWindow';
import { SetupScreen, TitleScreen } from './screens';
import { ITEMS, MERCHANTS, itemInfo, type MerchantKey } from './world-data';
import './game.css';

type Modal = { kind: 'trade'; key: MerchantKey } | { kind: 'bag' } | null;

export function GameScreen() {
  const mountRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Game | null>(null);
  const [game, setGame] = useState<Game | null>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [started, setStarted] = useState(false);
  const [tradeSteps, setTradeSteps] = useState<string[]>([]);
  const [, tick] = useState(0);

  const chain = useGameChain();
  const stamina = useStamina();
  const log = useTxLog();
  const session = useSession(chain.status === 'ready', stamina.sync);
  const actions = useGameActions({
    gameRef,
    stateRef: chain.stateRef,
    refresh: chain.refresh,
    stamina,
    log,
    openTrade: (key) => setModal({ kind: 'trade', key }),
    setTradeSteps,
  });

  // The engine is created once; it reaches the newest handlers through this ref.
  const handlers = useRef(actions);
  handlers.current = actions;

  /* ---------------------------------------------------------- engine */

  useEffect(() => {
    if (chain.status !== 'ready' || !mountRef.current || gameRef.current) return;
    const g = new Game(mountRef.current, {
      onTarget: setTarget,
      onInteract: (t) => handlers.current.interact(t),
      onSwingDone: (id) => handlers.current.swingDone(id),
    });
    gameRef.current = g;
    setGame(g);
    // Handles for the automated playtest (scripts/playtest.mjs).
    (window as unknown as { __game?: unknown }).__game = {
      game: g,
      state: () => chain.stateRef.current,
      stamina: () => stamina.valueRef.current,
      log: () => log.logRef.current,
    };
  }, [chain.status, chain.stateRef, stamina.valueRef, log.logRef]);

  useEffect(() => () => gameRef.current?.dispose(), []);

  // Feed on-chain cooldowns to the rocks.
  useEffect(() => {
    if (game && chain.state) game.setSpotReadyAt(new Map(chain.state.spots.map((sp) => [sp.spotId, sp.readyAt])));
  }, [game, chain.state]);

  useEffect(() => game?.setInputEnabled(started && modal === null), [game, started, modal]);

  // Re-render each second so cooldown countdowns in the prompt stay live.
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  /* --------------------------------------------------------- hotkeys */

  const eatFruit = actions.eatFruit;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!started || e.repeat) return;
      if ((e.target as HTMLElement | null)?.closest?.('input, textarea')) return;
      if (e.code === 'KeyI' || e.code === 'Tab') {
        e.preventDefault();
        setModal((m) => (m?.kind === 'bag' ? null : m === null ? { kind: 'bag' } : m));
      } else if (e.code === 'Escape' && modal?.kind === 'bag') {
        setModal(null);
      } else if (modal === null) {
        const fruit = ITEMS.find((i) => i.hotkey && `Digit${i.hotkey}` === e.code);
        if (fruit) eatFruit(fruit.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [started, modal, eatFruit]);

  const closeModal = useCallback(() => setModal(null), []);

  /* ---------------------------------------------------------- render */

  if (chain.status === 'offline' || chain.status === 'not-deployed') return <SetupScreen problem={chain.status} />;

  const s = chain.state;
  const merchantInfo = modal?.kind === 'trade' ? MERCHANTS.find((m) => m.key === modal.key)! : null;

  const promptDetail = (() => {
    if (!target || !s) return null;
    if (target.kind === 'merchant') return MERCHANTS.find((m) => m.key === target.key)!.title;
    if (target.kind !== 'spot') return null;
    const spot = s.spots.find((sp) => sp.spotId === target.spotId);
    if (!spot) return null;
    const left = Math.ceil(spot.readyAt - Date.now() / 1000);
    if (left > 0) return `regrowing · ${left}s`;
    const bonus = BigInt(s.pickaxeBonus);
    return `+${formatDurian(spot.durianReward * bonus)} DURIAN · +${(spot.oreAmount * bonus).toString()} ${itemInfo(spot.oreId).name}`;
  })();

  return (
    <div className="game">
      <div className="game-mount" ref={mountRef} />

      {!s ? (
        <div className="game-loading">Connecting to the chain…</div>
      ) : (
        <>
          <div className="hud-top-left">
            <StatusBar address={you.address} xp={s.timesMined} stamina={stamina.value} pickaxeBonus={s.pickaxeBonus} />
          </div>
          <div className="hud-top-right">
            <Purse durian={s.durian} eth={s.eth} block={s.blockNumber} flash={chain.balanceFlash} />
            <Minimap game={game} />
          </div>
          <div className="hud-bottom-left">
            {log.pending > 0 && (
              <div className="pending-pill">
                ⛓ waiting for {log.pending} transaction{log.pending > 1 ? 's' : ''}…
              </div>
            )}
            <ChainLog entries={log.log} />
          </div>
          <div className="hud-bottom">
            <Prompt target={modal ? null : target} detail={promptDetail} onPress={() => target && actions.interact(target)} />
            <Hotbar items={s.items} onEat={eatFruit} busy={false} />
          </div>
          <a className="ledger-link" href="#/dashboard">
            Ledger view ↗
          </a>
          {log.toast && (
            <div className="toast" key={log.toast.id} role="status">
              {log.toast.text}
            </div>
          )}

          {modal?.kind === 'bag' && <Inventory items={s.items} durian={s.durian} eth={s.eth} onEat={eatFruit} onClose={closeModal} busy={false} />}

          {modal?.kind === 'trade' && merchantInfo && (
            <TradeWindow
              key={modal.key}
              info={merchantInfo}
              merchant={s.merchants[modal.key]}
              you={{ durian: s.durian, eth: s.eth, items: s.items }}
              steps={tradeSteps}
              onClose={closeModal}
              onSay={(text) => game?.merchantSay(modal.key, text)}
              onSubmit={(give, take) => actions.tradeWith(modal.key, give, take)}
            />
          )}

          {!started && (
            <TitleScreen
              durian={s.durian}
              timesMined={s.timesMined}
              session={session}
              onPlay={() => {
                unlockAudio();
                sfx.open();
                setStarted(true);
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
