import { useState } from 'react';
import type { RunAction } from '../hooks/useActions';
import { formatDurian } from '../lib/format';
import { solvePuzzle, type Puzzle } from '../services/davao';

interface Props {
  puzzles: Puzzle[];
  rewardPool: bigint;
  run: RunAction;
  busy: boolean;
}

export function PuzzlesPanel({ puzzles, rewardPool, run, busy }: Props) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<Record<string, string>>({});
  const solvedCount = puzzles.filter((p) => p.solved).length;

  async function submit(puzzle: Puzzle) {
    const key = puzzle.id.toString();
    const answer = answers[key] ?? '';
    if (!answer.trim()) return;
    const ok = await run(`Solve puzzle ${puzzle.id + 1n}`, (onTx) => solvePuzzle(puzzle.id, answer, onTx));
    setFeedback((f) => ({ ...f, [key]: ok ? '' : 'Not quite. Try again.' }));
    if (ok) setAnswers((a) => ({ ...a, [key]: '' }));
  }

  return (
    <section className="panel panel--puzzles">
      <header className="panel__head">
        <div>
          <h2>Puzzles</h2>
          <p className="muted">Solve one and the contract pays you DURIAN from its reward pool.</p>
        </div>
        <div className="stat-chip">
          {solvedCount}/{puzzles.length} solved
        </div>
      </header>

      <ol className="puzzles">
        {puzzles.map((puzzle) => {
          const key = puzzle.id.toString();
          return (
            <li key={key} className={`puzzle ${puzzle.solved ? 'puzzle--solved' : ''}`}>
              <div className="puzzle__top">
                <span className="puzzle__num">{(puzzle.id + 1n).toString().padStart(2, '0')}</span>
                <p className="puzzle__q">{puzzle.question}</p>
                <span className="reward">+{formatDurian(puzzle.reward)}</span>
              </div>
              {puzzle.solved ? (
                <p className="puzzle__done">Solved. Reward paid to your wallet.</p>
              ) : (
                <form
                  className="inline-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void submit(puzzle);
                  }}
                >
                  <input
                    aria-label={`Answer to puzzle ${puzzle.id + 1n}`}
                    placeholder="Your answer"
                    value={answers[key] ?? ''}
                    onChange={(e) => setAnswers((a) => ({ ...a, [key]: e.target.value }))}
                    disabled={busy || !puzzle.active}
                  />
                  <button type="submit" disabled={busy || !puzzle.active || !(answers[key] ?? '').trim()}>
                    Submit
                  </button>
                </form>
              )}
              {feedback[key] && <p className="feedback">{feedback[key]}</p>}
            </li>
          );
        })}
      </ol>
      <p className="footnote">Reward pool: {formatDurian(rewardPool)} DURIAN</p>
    </section>
  );
}
