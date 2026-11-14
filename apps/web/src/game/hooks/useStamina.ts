// Stamina lives on the game server (it decides whether you may swing). The client keeps the
// server's last snapshot and computes regeneration locally, so the bar moves smoothly.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { StaminaJson } from '../../../shared/api';
import { STAMINA, staminaAt } from '../world-data';

export function useStamina() {
  const [snapshot, setSnapshot] = useState<StaminaJson>({ value: STAMINA.max, at: Date.now() });
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  const value = staminaAt(snapshot.value, snapshot.at, now);
  const valueRef = useRef(value);
  valueRef.current = value;

  /** Take the server's word. */
  const sync = useCallback((s: StaminaJson) => setSnapshot(s), []);

  /** Optimistic local spend, so the bar reacts before the server answers. */
  const spend = useCallback((cost: number) => {
    setSnapshot((s) => ({ value: Math.max(0, staminaAt(s.value, s.at, Date.now()) - cost), at: Date.now() }));
  }, []);

  return { value, valueRef, sync, spend };
}
