// Two-sided trade window: your offer on the left, the merchant's on the right, both
// inventories underneath. Accept, then confirm, then one atomic `Merchant.trade` on-chain.
import { useEffect, useState, type MouseEvent } from 'react';
import { formatUnits } from 'viem';
import { formatDurian, formatEth, parseDurian, parseEth } from '../../lib/format';
import { entries, isEmptyBundle, quote, type Bundle, type ItemCounts, type MerchantState } from '../../services/game';
import { ALL_ITEM_IDS, itemInfo, type ItemId, type MerchantInfo } from '../world-data';
import { DurianCoinIcon, EthIcon, ItemIcon } from './icons';
import { sfx } from '../engine/sfx';

const SLOTS = 6;
/** Keep a little ETH back for gas so a trade can't strand you. */
const GAS_RESERVE = 10n ** 15n; // 0.001 ETH

interface Props {
  info: MerchantInfo;
  merchant: MerchantState;
  you: { durian: bigint; eth: bigint; items: ItemCounts };
  steps: string[];
  onClose(): void;
  onSay(text: string): void;
  onSubmit(give: Bundle, take: Bundle): Promise<boolean>;
}

type Phase = 'edit' | 'confirm' | 'sending' | 'done';

const amountOf = (counts: ItemCounts, id: ItemId) => counts[id] ?? 0n;
const parseOrZero = (s: string, parse: (s: string) => bigint | null) => (s.trim() === '' ? 0n : parse(s));

function addItem(counts: ItemCounts, id: ItemId, delta: bigint, max: bigint): ItemCounts {
  const next = { ...counts };
  const v = (next[id] ?? 0n) + delta;
  next[id] = v < 0n ? 0n : v > max ? max : v;
  return next;
}

export function TradeWindow({ info, merchant, you, steps, onClose, onSay, onSubmit }: Props) {
  const [giveItems, setGiveItems] = useState<ItemCounts>({});
  const [takeItems, setTakeItems] = useState<ItemCounts>({});
  const [giveDurian, setGiveDurian] = useState('');
  const [giveEth, setGiveEth] = useState('');
  const [takeDurian, setTakeDurian] = useState('');
  const [takeEth, setTakeEth] = useState('');
  const [phase, setPhase] = useState<Phase>('edit');
  const [error, setError] = useState<string | null>(null);

  const buysEth = merchant.ethRate.buy > 0n;
  const sellsEth = merchant.ethRate.sell > 0n;

  const gd = parseOrZero(giveDurian, parseDurian);
  const ge = parseOrZero(giveEth, parseEth);
  const td = parseOrZero(takeDurian, parseDurian);
  const te = parseOrZero(takeEth, parseEth);
  const inputsValid = gd !== null && ge !== null && td !== null && te !== null;

  const give: Bundle = { durian: gd ?? 0n, eth: ge ?? 0n, items: giveItems };
  const take: Bundle = { durian: td ?? 0n, eth: te ?? 0n, items: takeItems };
  const value = quote(merchant, give, take);
  const giveValue = value?.give ?? 0n;
  const takeValue = value?.take ?? 0n;
  const empty = isEmptyBundle(give) && isEmptyBundle(take);

  // Every reason the trade can't go through, in plain words.
  const problems: string[] = [];
  {
    const p = problems;
    if (!inputsValid) p.push('One of the amounts is not a number.');
    if (give.durian > you.durian) p.push(`You only have ${formatDurian(you.durian)} DURIAN.`);
    if (give.eth > 0n && give.eth + GAS_RESERVE > you.eth) p.push('Not enough ETH (keep a little for gas).');
    if (take.durian > merchant.stock.durian) p.push(`${info.name} only has ${formatDurian(merchant.stock.durian)} DURIAN.`);
    if (take.eth > merchant.stock.eth) p.push(`${info.name} only has ${formatEth(merchant.stock.eth)} ETH.`);
    for (const [id, n] of entries(giveItems)) if (n > amountOf(you.items, id)) p.push(`You don't have ${n} ${itemInfo(id).name}.`);
    for (const [id, n] of entries(takeItems))
      if (n > amountOf(merchant.stock.items, id)) p.push(`${info.name} only has ${amountOf(merchant.stock.items, id)} ${itemInfo(id).name}.`);
  }

  const fair = !empty && value !== null && giveValue >= takeValue;
  const canAccept = fair && problems.length === 0 && phase === 'edit';
  const shortfall = takeValue > giveValue ? takeValue - giveValue : 0n;
  const surplus = giveValue > takeValue ? giveValue - takeValue : 0n;

  const mood = empty ? info.lines.empty : !fair ? info.lines.unfair : surplus > 0n ? info.lines.generous : info.lines.fair;

  // Any edit after accepting takes you back to editing, like un-readying in a real trade.
  useEffect(() => {
    if (phase === 'confirm') setPhase('edit');
    setError(null);
  }, [giveDurian, giveEth, takeDurian, takeEth, giveItems, takeItems]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape' && phase !== 'sending') {
        if (phase === 'confirm') setPhase('edit');
        else onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, onClose]);

  const step = (e: MouseEvent) => (e.shiftKey ? 10n : 1n);

  const offerFromInventory = (id: ItemId, e: MouseEvent) => {
    if (phase === 'sending') return;
    if ((merchant.prices[id]?.buy ?? 0n) === 0n) return;
    if (!(id in giveItems) && entries(giveItems).length >= SLOTS) return;
    sfx.click();
    setGiveItems((c) => addItem(c, id, step(e), amountOf(you.items, id)));
  };
  const requestFromStock = (id: ItemId, e: MouseEvent) => {
    if (phase === 'sending') return;
    if (!(id in takeItems) && entries(takeItems).length >= SLOTS) return;
    sfx.click();
    setTakeItems((c) => addItem(c, id, step(e), amountOf(merchant.stock.items, id)));
  };
  const removeSlot = (side: 'give' | 'take', id: ItemId, e: MouseEvent) => {
    e.preventDefault();
    if (phase === 'sending') return;
    sfx.click();
    const all = e.shiftKey || e.type === 'contextmenu';
    const set = side === 'give' ? setGiveItems : setTakeItems;
    set((c) => {
      const next = addItem(c, id, all ? -(c[id] ?? 0n) : -1n, c[id] ?? 0n);
      if ((next[id] ?? 0n) === 0n) delete next[id];
      return next;
    });
  };

  // Full precision here (not the 2-decimal display format), or the fix could still be 0.001 short.
  const coverShortfall = () => setGiveDurian(formatUnits((gd ?? 0n) + shortfall, 18));
  const askForChange = () => setTakeDurian(formatUnits((td ?? 0n) + surplus, 18));

  const accept = () => {
    if (!canAccept) return;
    sfx.click();
    setPhase('confirm');
  };

  const confirm = async () => {
    setPhase('sending');
    setError(null);
    const ok = await onSubmit(give, take);
    if (ok) {
      sfx.trade();
      setPhase('done');
      onSay(info.lines.thanks[Math.floor(Math.random() * info.lines.thanks.length)]!);
      setTimeout(() => {
        setGiveItems({});
        setTakeItems({});
        setGiveDurian('');
        setGiveEth('');
        setTakeDurian('');
        setTakeEth('');
        setPhase('edit');
      }, 1600);
    } else {
      sfx.error();
      setPhase('edit');
      setError('The trade did not go through. Nothing moved; check the log for the reason.');
    }
  };

  const meterMax = giveValue > takeValue ? giveValue : takeValue;
  const pct = (v: bigint) => (meterMax === 0n ? 0 : Number((v * 1000n) / meterMax) / 10);

  const yourInventory = ALL_ITEM_IDS.filter((id) => amountOf(you.items, id) > 0n);
  const theirStock = merchant.catalog.filter((id) => (merchant.prices[id]?.sell ?? 0n) > 0n);

  return (
    <div className="trade-backdrop" role="dialog" aria-label={`Trade with ${info.name}`}>
      <div className={`trade trade--${phase}`}>
        <header className="trade__head">
          <div>
            <span className="eyebrow">Trade</span>
            <h2>
              {info.name} <span className="trade__title">· {info.title}</span>
            </h2>
          </div>
          <button className="icon-btn" onClick={onClose} disabled={phase === 'sending'} aria-label="Close trade">
            ✕
          </button>
        </header>

        <div className="trade__table">
          {/* ---------------- your offer ---------------- */}
          <section className={`offer offer--you ${phase === 'confirm' || phase === 'sending' || phase === 'done' ? 'offer--ready' : ''}`}>
            <div className="offer__head">
              <h3>Your offer</h3>
              <span className="ready-light" title="You have accepted" />
            </div>
            <div className="slots">
              {Array.from({ length: SLOTS }, (_, i) => {
                const entry = entries(giveItems)[i];
                return entry ? (
                  <button key={i} className="slot slot--filled" onClick={(e) => removeSlot('give', entry[0], e)} onContextMenu={(e) => removeSlot('give', entry[0], e)} title={`${itemInfo(entry[0]).name}: click to remove one, right-click to remove all`}>
                    <ItemIcon id={entry[0]} size={38} />
                    <span className="slot__qty">×{entry[1].toString()}</span>
                  </button>
                ) : (
                  <div key={i} className="slot" />
                );
              })}
            </div>
            <div className="currency-row">
              <label>
                <DurianCoinIcon size={18} />
                <input inputMode="decimal" placeholder="0" value={giveDurian} onChange={(e) => setGiveDurian(e.target.value)} disabled={phase === 'sending'} aria-label="DURIAN you give" />
                <span>DURIAN</span>
              </label>
              {buysEth && (
                <label>
                  <EthIcon size={18} />
                  <input inputMode="decimal" placeholder="0" value={giveEth} onChange={(e) => setGiveEth(e.target.value)} disabled={phase === 'sending'} aria-label="ETH you give" />
                  <span>ETH</span>
                </label>
              )}
            </div>
            <div className="offer__value">
              Worth <strong>{formatDurian(giveValue)}</strong> DURIAN to {info.name.split(' ')[1]}
            </div>
          </section>

          {/* ---------------- the middle ---------------- */}
          <div className="trade__mid">
            <div className="swap-glyph" aria-hidden="true">⇄</div>
            <div className="meter" aria-label="Value balance">
              <div className="meter__bar meter__bar--give" style={{ width: `${pct(giveValue) / 2}%` }} />
              <div className="meter__bar meter__bar--take" style={{ width: `${pct(takeValue) / 2}%` }} />
              <div className="meter__tick" />
            </div>
            <p className={`mood ${fair ? 'mood--ok' : empty ? '' : 'mood--bad'}`}>“{mood}”</p>
            {!empty && shortfall > 0n && (
              <button className="chip-btn" onClick={coverShortfall} disabled={phase === 'sending'}>
                Add {formatDurian(shortfall)} DURIAN
              </button>
            )}
            {surplus > 0n && (
              <button className="chip-btn" onClick={askForChange} disabled={phase === 'sending'}>
                Ask for {formatDurian(surplus)} DURIAN back
              </button>
            )}
          </div>

          {/* ---------------- their offer ---------------- */}
          <section className={`offer offer--them ${fair && problems.length === 0 ? 'offer--ready' : ''}`}>
            <div className="offer__head">
              <h3>{info.name}'s offer</h3>
              <span className="ready-light" title={fair ? `${info.name} accepts` : `${info.name} is not ready`} />
            </div>
            <div className="slots">
              {Array.from({ length: SLOTS }, (_, i) => {
                const entry = entries(takeItems)[i];
                return entry ? (
                  <button key={i} className="slot slot--filled" onClick={(e) => removeSlot('take', entry[0], e)} onContextMenu={(e) => removeSlot('take', entry[0], e)} title={`${itemInfo(entry[0]).name}: click to remove one, right-click to remove all`}>
                    <ItemIcon id={entry[0]} size={38} />
                    <span className="slot__qty">×{entry[1].toString()}</span>
                  </button>
                ) : (
                  <div key={i} className="slot" />
                );
              })}
            </div>
            <div className="currency-row">
              <label>
                <DurianCoinIcon size={18} />
                <input inputMode="decimal" placeholder="0" value={takeDurian} onChange={(e) => setTakeDurian(e.target.value)} disabled={phase === 'sending'} aria-label="DURIAN you take" />
                <span>DURIAN</span>
              </label>
              {sellsEth && (
                <label>
                  <EthIcon size={18} />
                  <input inputMode="decimal" placeholder="0" value={takeEth} onChange={(e) => setTakeEth(e.target.value)} disabled={phase === 'sending'} aria-label="ETH you take" />
                  <span>ETH</span>
                </label>
              )}
            </div>
            <div className="offer__value">
              Costs <strong>{formatDurian(takeValue)}</strong> DURIAN
            </div>
          </section>
        </div>

        {/* ---------------- inventories / confirm ---------------- */}
        {phase === 'edit' ? (
          <div className="trade__stores">
            <section>
              <h4>
                Your bag <span className="muted">click to offer · shift ×10</span>
              </h4>
              <div className="store-grid">
                {yourInventory.length === 0 && <p className="store-empty">Your bag is empty. Go mine something!</p>}
                {yourInventory.map((id) => {
                  const buy = merchant.prices[id]?.buy ?? 0n;
                  const left = amountOf(you.items, id) - amountOf(giveItems, id);
                  return (
                    <button key={id} className={`store-tile ${buy === 0n ? 'store-tile--no' : ''}`} onClick={(e) => offerFromInventory(id, e)} disabled={buy === 0n || left <= 0n} title={itemInfo(id).description}>
                      <ItemIcon id={id} size={34} />
                      <span className="store-tile__name">{itemInfo(id).name}</span>
                      <span className="store-tile__qty">{left.toString()}</span>
                      <span className="store-tile__price">{buy === 0n ? 'Not buying' : `pays ${formatDurian(buy)}`}</span>
                    </button>
                  );
                })}
              </div>
            </section>
            <section>
              <h4>
                {info.name}'s stock <span className="muted">click to request</span>
              </h4>
              <div className="store-grid">
                {theirStock.map((id) => {
                  const left = amountOf(merchant.stock.items, id) - amountOf(takeItems, id);
                  return (
                    <button key={id} className="store-tile" onClick={(e) => requestFromStock(id, e)} disabled={left <= 0n} title={itemInfo(id).description}>
                      <ItemIcon id={id} size={34} />
                      <span className="store-tile__name">{itemInfo(id).name}</span>
                      <span className="store-tile__qty">{left.toString()}</span>
                      <span className="store-tile__price">costs {formatDurian(merchant.prices[id]!.sell)}</span>
                    </button>
                  );
                })}
                {sellsEth && (
                  <div className="store-tile store-tile--info">
                    <EthIcon size={30} />
                    <span className="store-tile__name">ETH</span>
                    <span className="store-tile__qty">{formatEth(merchant.stock.eth)}</span>
                    <span className="store-tile__price">
                      buys {formatDurian(merchant.ethRate.buy)} · sells {formatDurian(merchant.ethRate.sell)} / ETH
                    </span>
                  </div>
                )}
              </div>
            </section>
          </div>
        ) : (
          <div className="trade__confirm">
            <div className="confirm-cols">
              <div>
                <h4>You give</h4>
                <Summary bundle={give} />
              </div>
              <div>
                <h4>You receive</h4>
                <Summary bundle={take} />
              </div>
            </div>
            <ol className="tx-steps">
              {steps.length === 0 && phase === 'confirm' && (
                <li className="muted">
                  One transaction: <code>Merchant.trade()</code>. If the merchant needs permission to pull your DURIAN or items, an approval goes first.
                </li>
              )}
              {steps.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
              {phase === 'sending' && <li className="pulse">Waiting for the block…</li>}
              {phase === 'done' && <li className="ok">Trade complete. Both sides moved in the same transaction.</li>}
            </ol>
          </div>
        )}

        <footer className="trade__foot">
          <div className="trade__problems">
            {error && <span className="bad">{error}</span>}
            {!error && problems[0] && <span className="bad">{problems[0]}</span>}
          </div>
          {phase === 'edit' && (
            <button className="btn-accept" disabled={!canAccept} onClick={accept}>
              Accept
            </button>
          )}
          {phase === 'confirm' && (
            <>
              <button className="btn-ghost" onClick={() => setPhase('edit')}>
                Back
              </button>
              <button className="btn-accept btn-accept--confirm" onClick={confirm}>
                Confirm trade
              </button>
            </>
          )}
          {phase === 'sending' && <button className="btn-accept" disabled>Trading…</button>}
          {phase === 'done' && <button className="btn-accept" disabled>Done</button>}
        </footer>
      </div>
    </div>
  );
}

function Summary({ bundle }: { bundle: Bundle }) {
  const list = entries(bundle.items);
  if (isEmptyBundle(bundle)) return <p className="muted">Nothing</p>;
  return (
    <ul className="summary">
      {bundle.durian > 0n && (
        <li>
          <DurianCoinIcon size={18} /> {formatDurian(bundle.durian)} DURIAN
        </li>
      )}
      {bundle.eth > 0n && (
        <li>
          <EthIcon size={18} /> {formatEth(bundle.eth)} ETH
        </li>
      )}
      {list.map(([id, n]) => (
        <li key={id}>
          <ItemIcon id={id} size={22} /> {n.toString()} × {itemInfo(id).name}
        </li>
      ))}
    </ul>
  );
}
