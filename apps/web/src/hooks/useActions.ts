import { useCallback, useState } from 'react';
import type { Hash } from 'viem';
import type { OnTx } from '../services/davao';
import { describeError } from '../lib/format';

export interface Activity {
  id: number;
  label: string;
  status: 'pending' | 'done' | 'failed';
  txs: { step: string; hash: Hash }[];
  error?: string;
}

export type RunAction = (label: string, action: (onTx: OnTx) => Promise<void>) => Promise<boolean>;

let nextId = 1;

/**
 * Runs one user action at a time, records every transaction it sends,
 * and refreshes chain data when it finishes.
 */
export function useActions(refresh: () => Promise<void>) {
  const [activity, setActivity] = useState<Activity[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const update = (id: number, patch: (a: Activity) => Activity) =>
    setActivity((list) => list.map((a) => (a.id === id ? patch(a) : a)));

  const run: RunAction = useCallback(
    async (label, action) => {
      const id = nextId++;
      setBusy(label);
      setActivity((list) => [{ id, label, status: 'pending' as const, txs: [] }, ...list].slice(0, 25));
      try {
        await action((step, hash) => update(id, (a) => ({ ...a, txs: [...a.txs, { step, hash }] })));
        update(id, (a) => ({ ...a, status: 'done' }));
        return true;
      } catch (error) {
        update(id, (a) => ({ ...a, status: 'failed', error: describeError(error) }));
        return false;
      } finally {
        setBusy(null);
        await refresh();
      }
    },
    [refresh],
  );

  return { activity, busy, run };
}
