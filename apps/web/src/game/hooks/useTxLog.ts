// The on-screen transaction log, the pending-transaction counter, and toast messages.
import { useCallback, useRef, useState } from 'react';
import type { LogEntry } from '../hud/Hud';

let nextId = 1;

export function useTxLog() {
  const [log, setLog] = useState<LogEntry[]>([]);
  const [pending, setPending] = useState(0);
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  const logRef = useRef(log);
  logRef.current = log;

  const push = useCallback((entry: Omit<LogEntry, 'id'>) => setLog((l) => [{ ...entry, id: nextId++ }, ...l].slice(0, 12)), []);

  const showToast = useCallback((text: string) => {
    const id = nextId++;
    setToast({ id, text });
    setTimeout(() => setToast((t) => (t?.id === id ? null : t)), 2800);
  }, []);

  /** Counts an operation as pending for as long as `work` runs. */
  const track = useCallback(async <T,>(work: () => Promise<T>): Promise<T> => {
    setPending((p) => p + 1);
    try {
      return await work();
    } finally {
      setPending((p) => p - 1);
    }
  }, []);

  return { log, logRef, push, pending, track, toast, showToast };
}
