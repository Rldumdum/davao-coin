import { useState } from 'react';
import type { RunAction } from '../hooks/useActions';
import { nameOf, you } from '../lib/chain';
import { formatDurian, formatEth, parseDurian, parseEth } from '../lib/format';
import { buyOffer, cancelOffer, listOffer, withdrawProceeds, type Offer } from '../services/davao';

interface Props {
  offers: Offer[];
  wallet: bigint;
  eth: bigint;
  proceeds: bigint;
  run: RunAction;
  busy: boolean;
}

/** ETH per 1,000 DURIAN, so offers of different sizes can be compared. */
function pricePerThousand(offer: Offer): bigint {
  return (offer.priceWei * 1_000n * 10n ** 18n) / offer.amount;
}

export function MarketPanel({ offers, wallet, eth, proceeds, run, busy }: Props) {
  const [amount, setAmount] = useState('');
  const [price, setPrice] = useState('');
  const parsedAmount = parseDurian(amount);
  const parsedPrice = parseEth(price);

  const active = offers
    .filter((o) => o.active)
    .sort((a, b) => (pricePerThousand(a) < pricePerThousand(b) ? -1 : 1));
  const isMine = (o: Offer) => o.seller.toLowerCase() === you.address.toLowerCase();

  return (
    <section className="panel panel--market">
      <header className="panel__head">
        <div>
          <h2>Durian Market</h2>
          <p className="muted">Buy DURIAN from other people with ETH, or list your own. Cheapest first.</p>
        </div>
        <div className="stat-chip">{active.length} open offers</div>
      </header>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Seller</th>
              <th className="num">DURIAN</th>
              <th className="num">Price</th>
              <th className="num">Per 1,000</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {active.length === 0 && (
              <tr>
                <td colSpan={5} className="empty">
                  No open offers.
                </td>
              </tr>
            )}
            {active.map((offer) => (
              <tr key={offer.id.toString()} className={isMine(offer) ? 'mine' : ''}>
                <td>{nameOf(offer.seller)}</td>
                <td className="num">{formatDurian(offer.amount)}</td>
                <td className="num">{formatEth(offer.priceWei)} ETH</td>
                <td className="num muted">{formatEth(pricePerThousand(offer))}</td>
                <td className="action">
                  {isMine(offer) ? (
                    <button
                      className="secondary small"
                      disabled={busy}
                      onClick={() => run('Cancel your offer', (onTx) => cancelOffer(offer.id, onTx))}
                    >
                      Cancel
                    </button>
                  ) : (
                    <button
                      className="small"
                      disabled={busy || offer.priceWei > eth}
                      onClick={() =>
                        run(
                          `Buy ${formatDurian(offer.amount)} DURIAN from ${nameOf(offer.seller)}`,
                          (onTx) => buyOffer(offer, onTx),
                        )
                      }
                    >
                      Buy
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="field">
        <label>List your DURIAN for sale</label>
        <div className="inline-form">
          <input
            aria-label="Amount of DURIAN to sell"
            inputMode="decimal"
            placeholder="DURIAN"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={busy}
          />
          <input
            aria-label="Total price in ETH"
            inputMode="decimal"
            placeholder="Total ETH"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            disabled={busy}
          />
          <button
            disabled={busy || parsedAmount === null || parsedPrice === null || parsedAmount > wallet}
            onClick={async () => {
              const ok = await run(`List ${amount} DURIAN for ${price} ETH`, (onTx) =>
                listOffer(parsedAmount!, parsedPrice!, onTx),
              );
              if (ok) {
                setAmount('');
                setPrice('');
              }
            }}
          >
            List
          </button>
        </div>
        <p className="hint">Listed tokens are held by the market contract until someone buys them or you cancel.</p>
      </div>

      <div className="proceeds">
        <span>
          Sales waiting for you: <strong>{formatEth(proceeds)} ETH</strong>
        </span>
        <button
          className="secondary small"
          disabled={busy || proceeds === 0n}
          onClick={() => run('Withdraw sale proceeds', withdrawProceeds)}
        >
          Withdraw
        </button>
      </div>
    </section>
  );
}
