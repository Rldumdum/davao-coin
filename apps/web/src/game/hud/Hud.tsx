// RPG HUD pieces. All presentational: GameScreen owns the state.
import { useEffect, useRef } from 'react';
import { formatDurian, formatEth } from '../../lib/format';
import type { ItemCounts } from '../../services/game';
import { ALL_ITEM_IDS, HUTS, ITEMS, MERCHANTS, MINE_SPOTS, STAMINA, WORLD_RADIUS, itemInfo, type ItemId } from '../world-data';
import type { Game, Target } from '../engine/Game';
import { DurianCoinIcon, EthIcon, ItemIcon } from './icons';

/* ------------------------------------------------------------ levels */

/** XP = lifetime swings (DurianMine.timesMined). Level L needs 5·L·(L-1)/2 XP. */
export function levelFor(xp: number) {
  let level = 1;
  while (xp >= (5 * level * (level + 1)) / 2) level++;
  const floor = (5 * level * (level - 1)) / 2;
  const next = (5 * level * (level + 1)) / 2;
  return { level, into: xp - floor, needed: next - floor };
}

const TITLES: [number, string][] = [
  [8, 'Apo Legend'],
  [5, 'Prospector'],
  [3, 'Miner'],
  [1, 'Newcomer'],
];
const titleFor = (level: number) => TITLES.find(([min]) => level >= min)![1];

/* -------------------------------------------------------- status bar */

interface StatusProps {
  address: string;
  xp: number;
  stamina: number;
  pickaxeBonus: number;
}

export function StatusBar({ address, xp, stamina, pickaxeBonus }: StatusProps) {
  const { level, into, needed } = levelFor(xp);
  const tool = pickaxeBonus >= 3 ? 'Gold Pickaxe' : pickaxeBonus === 2 ? 'Iron Pickaxe' : 'Old Pickaxe';
  return (
    <section className="hud-status" aria-label="Character status">
      <div className="portrait" aria-hidden="true">
        <svg viewBox="0 0 64 64" width="58" height="58">
          <circle cx="32" cy="32" r="31" fill="#2e6f5e" />
          <circle cx="32" cy="36" r="15" fill="#b97a4f" />
          <path d="M15 31 C15 18 49 18 49 31 Z" fill="#f2b632" />
          <rect x="12" y="29" width="40" height="4" rx="2" fill="#d99a1e" />
          <circle cx="27" cy="38" r="2" fill="#16110d" />
          <circle cx="37" cy="38" r="2" fill="#16110d" />
          <path d="M28 44 Q32 47 36 44" stroke="#16110d" strokeWidth="2" fill="none" strokeLinecap="round" />
        </svg>
        <span className="portrait__level">{level}</span>
      </div>
      <div className="hud-status__body">
        <div className="hud-status__name">
          <strong>You</strong>
          <span>
            Lv {level} {titleFor(level)}
          </span>
        </div>
        <Bar kind="stamina" label="Stamina" value={stamina} max={STAMINA.max} text={`${Math.floor(stamina)} / ${STAMINA.max}`} />
        <Bar kind="xp" label="XP" value={into} max={needed} text={`${into} / ${needed}`} />
        <div className="hud-status__meta">
          <span className="mono">{`${address.slice(0, 6)}…${address.slice(-4)}`}</span>
          <span>
            {tool} ×{pickaxeBonus}
          </span>
        </div>
      </div>
    </section>
  );
}

function Bar({ kind, label, value, max, text }: { kind: string; label: string; value: number; max: number; text: string }) {
  const pct = max === 0 ? 0 : Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className={`bar bar--${kind}`} role="meter" aria-label={label} aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={max}>
      <span className="bar__label">{label}</span>
      <div className="bar__track">
        <div className="bar__fill" style={{ width: `${pct}%` }} />
        <span className="bar__text">{text}</span>
      </div>
    </div>
  );
}

/* --------------------------------------------------------- currencies */

export function Purse({ durian, eth, block, flash, stale = false }: { durian: bigint; eth: bigint; block: bigint; flash: boolean; stale?: boolean }) {
  return (
    <section className={`hud-purse ${flash ? 'hud-purse--flash' : ''}`} aria-label="Wallet">
      <div className="purse-row">
        <DurianCoinIcon size={22} />
        <span className="purse-row__amt">{formatDurian(durian)}</span>
        <span className="purse-row__sym">DURIAN</span>
      </div>
      <div className="purse-row">
        <EthIcon size={22} />
        <span className="purse-row__amt">{formatEth(eth)}</span>
        <span className="purse-row__sym">ETH</span>
      </div>
      <div className={`purse-block ${stale ? 'purse-block--stale' : ''}`} title={stale ? 'The last chain read failed; retrying' : 'Live'}>
        <span className="live-dot" /> {stale ? 'reconnecting…' : `block ${block.toString()}`}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ hotbar */

export function Hotbar({ items, onEat, busy }: { items: ItemCounts; onEat(id: ItemId): void; busy: boolean }) {
  const fruits = ITEMS.filter((i) => i.kind === 'fruit');
  return (
    <nav className="hotbar" aria-label="Quick items">
      {fruits.map((f) => {
        const n = items[f.id] ?? 0n;
        return (
          <button key={f.id} className="hotbar__slot" disabled={n === 0n || busy} onClick={() => onEat(f.id)} title={`${f.name}: +${f.stamina} stamina (key ${f.hotkey})`}>
            <span className="hotbar__key">{f.hotkey}</span>
            <ItemIcon id={f.id} size={34} />
            <span className="hotbar__qty">{n.toString()}</span>
          </button>
        );
      })}
      <div className="hotbar__sep" />
      <div className="hotbar__hint">
        <kbd>E</kbd> interact <kbd>I</kbd> bag <kbd>Shift</kbd> run
      </div>
    </nav>
  );
}

/* ------------------------------------------------------------ prompt */

export function Prompt({ target, detail, onPress }: { target: Target | null; detail: string | null; onPress(): void }) {
  if (!target) return null;
  const verb = target.kind === 'spot' ? 'Mine' : target.kind === 'merchant' ? 'Trade with' : 'Talk to';
  return (
    <button className="prompt" onClick={onPress}>
      <kbd>E</kbd>
      <span>
        <span>
          {verb} <strong>{target.name}</strong>
        </span>
        {detail && <em>{detail}</em>}
      </span>
    </button>
  );
}

/* --------------------------------------------------------- inventory */

export function Inventory({ items, durian, eth, onEat, onClose, busy }: { items: ItemCounts; durian: bigint; eth: bigint; onEat(id: ItemId): void; onClose(): void; busy: boolean }) {
  const owned = ALL_ITEM_IDS.filter((id) => (items[id] ?? 0n) > 0n);
  return (
    <div className="bag" role="dialog" aria-label="Inventory">
      <header className="bag__head">
        <h2>Bag</h2>
        <button className="icon-btn" onClick={onClose} aria-label="Close bag">
          ✕
        </button>
      </header>
      <div className="bag__purse">
        <span>
          <DurianCoinIcon size={18} /> {formatDurian(durian)} DURIAN
        </span>
        <span>
          <EthIcon size={18} /> {formatEth(eth)} ETH
        </span>
      </div>
      {owned.length === 0 ? (
        <p className="bag__empty">Nothing yet. Swing at a vein on the mountain (north of the plaza).</p>
      ) : (
        <ul className="bag__list">
          {owned.map((id) => {
            const info = itemInfo(id);
            return (
              <li key={id} className="bag__item">
                <ItemIcon id={id} size={40} />
                <div>
                  <div className="bag__name">
                    {info.name} <span className="bag__qty">×{(items[id] ?? 0n).toString()}</span>
                  </div>
                  <div className="bag__desc">{info.description}</div>
                </div>
                {info.kind === 'fruit' && (
                  <button className="chip-btn" onClick={() => onEat(id)} disabled={busy}>
                    Eat
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="bag__foot">
        Items are ERC-1155 tokens on DavaoItems. Eating burns one.
      </p>
    </div>
  );
}

/* ----------------------------------------------------------- minimap */

export function Minimap({ game }: { game: Game | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!game) return;
    let raf = 0;
    const draw = () => {
      const canvas = ref.current;
      const ctx = canvas?.getContext('2d');
      if (canvas && ctx) {
        const S = canvas.width;
        const scale = S / 2 / (WORLD_RADIUS + 6);
        const pose = game.getPose();
        ctx.clearRect(0, 0, S, S);
        ctx.save();
        ctx.beginPath();
        ctx.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2);
        ctx.clip();
        ctx.fillStyle = '#2b86b0';
        ctx.fillRect(0, 0, S, S);
        const P = (x: number, z: number): [number, number] => [S / 2 + x * scale, S / 2 + z * scale];
        const dot = (x: number, z: number, r: number, color: string) => {
          const [px, py] = P(x, z);
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(px, py, r, 0, Math.PI * 2);
          ctx.fill();
        };
        dot(0, 0, (WORLD_RADIUS + 5) * scale, '#e5d2a0');
        dot(0, 0, (WORLD_RADIUS + 0.5) * scale, '#76ad52');
        dot(2, -29, 15 * scale, '#a59276');
        ctx.fillStyle = '#5c6656';
        ctx.fillRect(P(-36, -50)[0], P(-36, -50)[1], 74 * scale, 9 * scale);
        dot(0, 0, 9.5 * scale, '#d6c8a8');
        for (const h of HUTS) dot(h.x, h.z, 2 * scale, '#8a6a3a');
        for (const s of MINE_SPOTS) dot(s.x, s.z, 3, s.ore === 4 ? '#b77bff' : s.ore === 3 ? '#f5c62a' : s.ore === 2 ? '#e6edf2' : '#c8743a');
        for (const m of MERCHANTS) dot(m.x, m.z, 3.5, m.awning[0]);
        for (const v of game.getVillagerPositions()) dot(v.x, v.z, 2, '#fff8e6');
        // Player arrow.
        const [px, py] = P(pose.x, pose.z);
        ctx.translate(px, py);
        ctx.rotate(-pose.heading + Math.PI);
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#1d2a1f';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(0, -6);
        ctx.lineTo(4.5, 5);
        ctx.lineTo(0, 2.5);
        ctx.lineTo(-4.5, 5);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [game]);
  return (
    <div className="minimap">
      <canvas ref={ref} width={150} height={150} aria-label="Map" />
      <span className="minimap__n">N</span>
    </div>
  );
}

/* --------------------------------------------------------- chain log */

export interface LogEntry {
  id: number;
  text: string;
  hash?: string;
  block?: bigint;
  tone: 'ok' | 'bad' | 'info';
}

export function ChainLog({ entries }: { entries: LogEntry[] }) {
  return (
    <section className="chainlog" aria-label="Transaction log" aria-live="polite">
      {entries.slice(0, 5).map((e) => (
        <div key={e.id} className={`chainlog__row chainlog__row--${e.tone}`}>
          <span>{e.text}</span>
          {e.hash && (
            <span className="mono muted">
              #{e.block?.toString()} · {e.hash.slice(0, 8)}…
            </span>
          )}
        </div>
      ))}
    </section>
  );
}
