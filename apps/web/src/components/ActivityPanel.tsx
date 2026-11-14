import type { Activity } from '../hooks/useActions';

const STATUS_LABEL: Record<Activity['status'], string> = {
  pending: 'Pending',
  done: 'Confirmed',
  failed: 'Failed',
};

export function ActivityPanel({ activity }: { activity: Activity[] }) {
  return (
    <section className="panel">
      <header className="panel__head">
        <div>
          <h2>Activity</h2>
          <p className="muted">Every transaction you send, with its hash.</p>
        </div>
      </header>
      {activity.length === 0 ? (
        <p className="empty">Nothing yet. Solve a puzzle to earn your first DURIAN.</p>
      ) : (
        <ul className="activity">
          {activity.map((a) => (
            <li key={a.id}>
              <div className="activity__row">
                <span>{a.label}</span>
                <span className={`status status--${a.status}`}>{STATUS_LABEL[a.status]}</span>
              </div>
              {a.txs.map((tx) => (
                <div key={tx.hash} className="tx">
                  {tx.step} <code>{`${tx.hash.slice(0, 10)}…${tx.hash.slice(-6)}`}</code>
                </div>
              ))}
              {a.error && <div className="error">{a.error}</div>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
