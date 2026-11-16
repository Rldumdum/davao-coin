// Polls the chain for everything the game shows, and flags when your balance changes.
import { useCallback, useEffect, useRef, useState } from 'react';
import { POLL_MS } from '../../lib/chain';
import { gameIsDeployed, loadGameState, type GameState } from '../../services/game';

export type ChainStatus = 'loading' | 'offline' | 'not-deployed' | 'ready';


export function useGameChain() {
  const [status, setStatus] = useState<ChainStatus>('loading');
  const [state, setState] = useState<GameState | null>(null);
  const [balanceFlash, setBalanceFlash] = useState(false);
  /** True while the latest poll failed and the screen shows slightly old data. */
  const [stale, setStale] = useState(false);
  /** Always the latest state, for callbacks that outlive a render. */
  const stateRef = useRef<GameState | null>(null);

  const inFlight = useRef<Promise<void> | null>(null);
  const deployedChecked = useRef(false);

  const load = useCallback(async () => {
    try {
      // Contract code doesn't disappear, so check it once, not on every poll.
      if (!deployedChecked.current) {
        if (!(await gameIsDeployed())) return setStatus('not-deployed');
        deployedChecked.current = true;
      }
      const next = await loadGameState();
      const prev = stateRef.current;
      if (prev && (next.durian !== prev.durian || next.eth !== prev.eth)) {
        setBalanceFlash(true);
        setTimeout(() => setBalanceFlash(false), 700);
      }
      stateRef.current = next;
      setState(next);
      setStatus('ready');
      setStale(false);
    } catch {
      // Before the first successful load, "offline" shows setup help. After it, a failed poll
      // (e.g. a rate-limited RPC) keeps the last good state on screen instead of tearing the
      // game down; the next poll usually succeeds.
      if (stateRef.current) setStale(true);
      else setStatus('offline');
    }
  }, []);

  /** Never runs two polls at once: under rate limiting, overlapping polls only make it worse. */
  const refresh = useCallback(() => {
    inFlight.current ??= load().finally(() => (inFlight.current = null));
    return inFlight.current;
  }, [load]);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  return { status, state, stateRef, refresh, balanceFlash, stale };
}
