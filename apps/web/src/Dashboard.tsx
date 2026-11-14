import { ActivityPanel } from './components/ActivityPanel';
import { BankPanel } from './components/BankPanel';
import { MarketPanel } from './components/MarketPanel';
import { PeoplePanel } from './components/PeoplePanel';
import { PuzzlesPanel } from './components/PuzzlesPanel';
import { useActions } from './hooks/useActions';
import { useSnapshot } from './hooks/useSnapshot';
import { you } from './lib/chain';
import { formatDurian, formatEth } from './lib/format';

function SetupNotice({ title, body }: { title: string; body: string }) {
  return (
    <main className="setup">
      <h1>{title}</h1>
      <p>{body}</p>
      <pre>
        {`# terminal 1, in davao-coin/
anvil

# terminal 2, in davao-coin/
forge script script/DeployLocal.s.sol --rpc-url http://127.0.0.1:8545 --broadcast`}
      </pre>
      <p className="muted">This page retries every few seconds.</p>
    </main>
  );
}

export function Dashboard() {
  const { state, refresh } = useSnapshot();
  const { activity, busy, run } = useActions(refresh);

  if (state.status === 'loading') return <main className="setup">Connecting to the local chain…</main>;
  if (state.status === 'offline')
    return <SetupNotice title="Can't reach the chain" body="Nothing is answering at 127.0.0.1:8545. Start anvil." />;
  if (state.status === 'not-deployed')
    return (
      <SetupNotice
        title="Contracts not deployed"
        body="anvil is running, but the contracts aren't on it. anvil starts empty every time, so deploy again."
      />
    );

  const s = state.snapshot;
  const isBusy = busy !== null;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand__mark" aria-hidden="true" />
          <div>
            <h1>Davao Coin</h1>
            <p className="muted">
              DURIAN on a local chain · block {s.blockNumber.toString()}
            </p>
          </div>
        </div>
        <a className="game-link" href="#/">Play the game ↗</a>
        <dl className="wallet">
          <div>
            <dt>You</dt>
            <dd className="mono">{`${you.address.slice(0, 6)}…${you.address.slice(-4)}`}</dd>
          </div>
          <div>
            <dt>Wallet</dt>
            <dd>{formatDurian(s.wallet)} DURIAN</dd>
          </div>
          <div>
            <dt>Bank</dt>
            <dd>{formatDurian(s.bank)} DURIAN</dd>
          </div>
          <div>
            <dt>ETH</dt>
            <dd>{formatEth(s.eth)}</dd>
          </div>
        </dl>
      </header>

      {busy && (
        <div className="busy" role="status">
          {busy}…
        </div>
      )}

      <main className="grid">
        <div className="col">
          <PuzzlesPanel puzzles={s.puzzles} rewardPool={s.rewardPool} run={run} busy={isBusy} />
          <BankPanel wallet={s.wallet} bank={s.bank} run={run} busy={isBusy} />
        </div>
        <div className="col">
          <MarketPanel
            offers={s.offers}
            wallet={s.wallet}
            eth={s.eth}
            proceeds={s.proceeds}
            run={run}
            busy={isBusy}
          />
          <PeoplePanel people={s.people} />
          <ActivityPanel activity={activity} />
        </div>
      </main>
    </div>
  );
}
