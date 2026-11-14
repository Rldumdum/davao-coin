// Registers the session wallet with the game server once the chain is reachable.
import { useEffect, useState } from 'react';
import type { StaminaJson } from '../../../shared/api';
import { formatEth } from '../../lib/format';
import { describeError } from '../../lib/format';
import { startSession } from '../../services/game';

export type SessionStatus = { kind: 'idle' } | { kind: 'starting' } | { kind: 'ready'; note: string | null } | { kind: 'error'; message: string };

export function useSession(chainReady: boolean, onStamina: (s: StaminaJson) => void) {
  const [status, setStatus] = useState<SessionStatus>({ kind: 'idle' });

  useEffect(() => {
    if (!chainReady || status.kind !== 'idle') return;
    setStatus({ kind: 'starting' });
    startSession()
      .then((s) => {
        onStamina(s.stamina);
        const note = s.dripWei
          ? `The faucet sent your new wallet ${formatEth(s.dripWei)} ETH for gas.`
          : (s.dripRefused ?? null);
        setStatus({ kind: 'ready', note });
      })
      .catch((err: unknown) => setStatus({ kind: 'error', message: describeError(err) }));
  }, [chainReady, status.kind, onStamina]);

  return status;
}
