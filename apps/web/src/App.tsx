import { Suspense, lazy, useEffect, useState } from 'react';

// Each screen is its own chunk: the game pulls in three.js, the dashboard doesn't need it.
const GameScreen = lazy(() => import('./game/GameScreen').then((m) => ({ default: m.GameScreen })));
const Dashboard = lazy(() => import('./Dashboard').then((m) => ({ default: m.Dashboard })));

/** `#/dashboard` is the original ledger UI; everything else is the 3D game. */
function useHashRoute() {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return hash;
}

export function App() {
  const route = useHashRoute();
  return (
    <Suspense fallback={<main className="setup">Loading…</main>}>{route === '#/dashboard' ? <Dashboard /> : <GameScreen />}</Suspense>
  );
}
