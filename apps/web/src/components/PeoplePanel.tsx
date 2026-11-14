import { formatDurian } from '../lib/format';
import type { Holder } from '../services/davao';

export function PeoplePanel({ people }: { people: Holder[] }) {
  return (
    <section className="panel">
      <header className="panel__head">
        <div>
          <h2>People</h2>
          <p className="muted">Sample holders seeded by the deploy script.</p>
        </div>
      </header>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th className="num">Wallet</th>
              <th className="num">Bank</th>
            </tr>
          </thead>
          <tbody>
            {people.map((p) => (
              <tr key={p.address}>
                <td>
                  {p.name}
                  <span className="addr">{`${p.address.slice(0, 6)}…${p.address.slice(-4)}`}</span>
                </td>
                <td className="num">{formatDurian(p.wallet)}</td>
                <td className="num">{formatDurian(p.bank)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
