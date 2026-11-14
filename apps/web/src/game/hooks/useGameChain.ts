// Polls the chain for everything the game shows, and flags when your balance changes.
import { useCallback, useEffect, useRef, useState } from 'react';
import { gameIsDeployed, loadGameState, type GameState } from '../../services/game';

export type ChainStatus = 'loading' | 'offline' | 'not-deployed' | 'ready';

const POLL_MS = 2500;

export function useGameChain() {
  const [status, setStatus] = useState<ChainStatus>('loading');
  const [state, setState] = useState<GameState | null>(null);
  const [balanceFlash, setBalanceFlash] = useState(false);
  /** Always the latest state, for callbacks that outlive a render. */
  const stateRef = useRef<GameState | null>(null);

  const refresh = useCallback(async () => {
    try {
      if (!(await gameIsDeployed())) return setStatus('not-deployed');
      const next = await loadGameState();
      const prev = stateRef.current;
      if (prev && (next.durian !== prev.durian || next.eth !== prev.eth)) {
        setBalanceFlash(true);
        setTimeout(() => setBalanceFlash(false), 700);
      }
      stateRef.current = next;
      setState(next);
      setStatus('ready');
    } catch {
      setStatus('offline');
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  return { status, state, stateRef, refresh, balanceFlash };
}
