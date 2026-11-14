// Full-screen states around the game: chain unreachable / not deployed, and the title card.
import { formatDurian } from '../lib/format';
import { network } from '../lib/chain';
import type { SessionStatus } from './hooks/useSession';
import { levelFor } from './hud/Hud';

export function SetupScreen({ problem }: { problem: 'offline' | 'not-deployed' }) {
  const local = network.name === 'local';
  return (
    <main className="setup">
      <h1>{problem === 'offline' ? "Can't reach the chain" : 'Game contracts not deployed'}</h1>
      <p>
        {problem === 'offline'
          ? `Nothing is answering on the ${network.name} RPC.${local ? ' Start anvil.' : ''}`
          : `No game contracts for ${network.name} (chain ${network.chain.id}).${local ? ' anvil starts empty every time, so deploy again.' : ''}`}
      </p>
      {local && (
        <pre>{`# terminal 1, in contracts/
anvil

# terminal 2, in contracts/
forge script script/DeployLocal.s.sol --rpc-url local --broadcast

# then, in apps/web/ (picks up the new addresses)
npm run sync`}</pre>
      )}
      <p className="muted">This page retries every few seconds.</p>
    </main>
  );
}

interface TitleProps {
  durian: bigint;
  timesMined: number;
  session: SessionStatus;
  onPlay(): void;
}

export function TitleScreen({ durian, timesMined, session, onPlay }: TitleProps) {
  const ready = session.kind === 'ready';
  return (
    <div className="title-screen">
      <div className="title-card">
        <span className="eyebrow">Davao Coin presents</span>
        <h1>Barangay Durian</h1>
        <p>
          Mine the mountain for <strong>DURIAN</strong> and ore, trade with the merchants in the plaza, and eat fruit to keep going. Every swing, every bite and every trade is a real transaction on{' '}
          {network.name === 'local' ? 'your local chain' : 'Base Sepolia (testnet)'}.
        </p>
        <ul className="controls">
          <li>
            <kbd>W</kbd>
            <kbd>A</kbd>
            <kbd>S</kbd>
            <kbd>D</kbd> move · <kbd>Shift</kbd> run
          </li>
          <li>drag to look · scroll to zoom</li>
          <li>
            <kbd>E</kbd> mine / trade / talk
          </li>
          <li>
            <kbd>I</kbd> bag · <kbd>1</kbd>
            <kbd>2</kbd>
            <kbd>3</kbd> eat fruit
          </li>
        </ul>
        <p className="title-card__you">
          Level {levelFor(timesMined).level} · {formatDurian(durian)} DURIAN · {timesMined} swings so far
        </p>
        {session.kind === 'starting' && <p className="title-card__you">Setting up your wallet (and getting gas money from the faucet)…</p>}
        {session.kind === 'ready' && session.note && <p className="title-card__you">{session.note}</p>}
        {session.kind === 'error' && <p className="title-card__error">Game server unreachable: {session.message}</p>}
        <button className="btn-accept" autoFocus disabled={!ready} onClick={onPlay}>
          {ready ? 'Play' : 'Loading…'}
        </button>
      </div>
    </div>
  );
}
