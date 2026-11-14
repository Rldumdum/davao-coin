import { useCallback, useEffect, useState } from 'react';
import { contractsAreDeployed, loadSnapshot, type Snapshot } from '../services/davao';
import { describeError } from '../lib/format';

export type ChainState =
  | { status: 'loading' }
  | { status: 'offline'; error: string }
  | { status: 'not-deployed' }
  | { status: 'ready'; snapshot: Snapshot };

const POLL_MS = 3000;

/** Reads the chain on an interval, plus on demand after every transaction. */
export function useSnapshot() {
  const [state, setState] = useState<ChainState>({ status: 'loading' });

  const refresh = useCallback(async () => {
    try {
      if (!(await contractsAreDeployed())) return setState({ status: 'not-deployed' });
      setState({ status: 'ready', snapshot: await loadSnapshot() });
    } catch (error) {
      setState({ status: 'offline', error: describeError(error) });
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  return { state, refresh };
}
