import { useState } from 'react';
import type { Address } from 'viem';
import type { RunAction } from '../hooks/useActions';
import { SAMPLE_PEOPLE } from '../lib/chain';
import { formatDurian, parseDurian } from '../lib/format';
import { depositToBank, sendInBank, withdrawFromBank } from '../services/davao';

interface Props {
  wallet: bigint;
  bank: bigint;
  run: RunAction;
  busy: boolean;
}

export function BankPanel({ wallet, bank, run, busy }: Props) {
  const [amount, setAmount] = useState('');
  const [sendTo, setSendTo] = useState<Address>(SAMPLE_PEOPLE[0]!.address);
  const [sendAmount, setSendAmount] = useState('');

  const parsed = parseDurian(amount);
  const parsedSend = parseDurian(sendAmount);
  const recipient = SAMPLE_PEOPLE.find((p) => p.address === sendTo)?.name ?? 'recipient';

  async function act(label: string, fn: Parameters<RunAction>[1], reset: () => void) {
    if (await run(label, fn)) reset();
  }

  return (
    <section className="panel">
      <header className="panel__head">
        <div>
          <h2>Davao Bank</h2>
          <p className="muted">Park DURIAN in the bank and send it to other account holders.</p>
        </div>
      </header>

      <div className="balance-pair">
        <div>
          <span className="label">In your wallet</span>
          <strong>{formatDurian(wallet)}</strong>
        </div>
        <div>
          <span className="label">In the bank</span>
          <strong>{formatDurian(bank)}</strong>
        </div>
      </div>

      <div className="field">
        <label htmlFor="bank-amount">Amount (DURIAN)</label>
        <div className="inline-form">
          <input
            id="bank-amount"
            inputMode="decimal"
            placeholder="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={busy}
          />
          <button
            disabled={busy || parsed === null || parsed > wallet}
            onClick={() =>
              act(`Deposit ${amount} DURIAN`, (onTx) => depositToBank(parsed!, onTx), () => setAmount(''))
            }
          >
            Deposit
          </button>
          <button
            className="secondary"
            disabled={busy || parsed === null || parsed > bank}
            onClick={() =>
              act(`Withdraw ${amount} DURIAN`, (onTx) => withdrawFromBank(parsed!, onTx), () => setAmount(''))
            }
          >
            Withdraw
          </button>
        </div>
        <p className="hint">Depositing takes two transactions the first time: approve, then deposit.</p>
      </div>

      <div className="field">
        <label htmlFor="send-amount">Send from your bank account</label>
        <div className="inline-form">
          <select value={sendTo} onChange={(e) => setSendTo(e.target.value as Address)} disabled={busy}>
            {SAMPLE_PEOPLE.map((p) => (
              <option key={p.address} value={p.address}>
                {p.name}
              </option>
            ))}
          </select>
          <input
            id="send-amount"
            inputMode="decimal"
            placeholder="0"
            value={sendAmount}
            onChange={(e) => setSendAmount(e.target.value)}
            disabled={busy}
          />
          <button
            disabled={busy || parsedSend === null || parsedSend > bank}
            onClick={() =>
              act(
                `Send ${sendAmount} DURIAN to ${recipient}`,
                (onTx) => sendInBank(sendTo, parsedSend!, onTx),
                () => setSendAmount(''),
              )
            }
          >
            Send
          </button>
        </div>
      </div>
    </section>
  );
}
