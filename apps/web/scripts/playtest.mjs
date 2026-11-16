// Headless playtest: plays the game against a chain, writes screenshots + a report.
//   (in contracts/) anvil --port 8546  &&  forge script script/DeployLocal.s.sol --rpc-url http://127.0.0.1:8546 --broadcast
//   PLAYTEST_RPC=http://127.0.0.1:8546 node scripts/playtest.mjs
// It mines and trades for real, so point it at a throwaway chain, not the one you play on.
//
// Live mode: PLAYTEST_URL=https://davao-coin.vercel.app node scripts/playtest.mjs
// plays the deployed site as a brand-new visitor (spends one faucet drip of testnet ETH).
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

const OUT = process.env.PLAYTEST_OUT ?? 'playtest';
const LIVE = process.env.PLAYTEST_URL;
// Real networks confirm in seconds, not instantly like anvil: give transactions longer.
const SLOW = LIVE ? 4 : 1;
await mkdir(`${OUT}/shots`, { recursive: true });

let server = null;
let url = LIVE;
if (!LIVE) {
  // Both the browser (VITE_RPC_URL) and the dev API (RPC_URL) must point at the throwaway chain.
  process.env.VITE_RPC_URL = process.env.RPC_URL = process.env.PLAYTEST_RPC ?? 'http://127.0.0.1:8546';
  server = await createServer({ server: { port: 5193, strictPort: true }, logLevel: 'error' });
  await server.listen();
  url = server.resolvedUrls.local[0];
}

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));
// Console errors don't say WHICH request failed; record status + URL (path only, no query).
const failedRequests = {};
page.on('response', (r) => {
  if (r.status() < 400) return;
  const u = new URL(r.url());
  const key = `${r.status()} ${r.request().method()} ${u.host}${u.pathname}`;
  failedRequests[key] = (failedRequests[key] ?? 0) + 1;
});
const report = { steps: [], errors, failedRequests };

const shot = async (name, note) => {
  await page.screenshot({ path: `${OUT}/shots/${name}.png` });
  const s = await page.evaluate(() => {
    const g = window.__game;
    const st = g?.state();
    if (!st) return null;
    const pose = g.game.getPose();
    return {
      pos: [Math.round(pose.x * 10) / 10, Math.round(pose.z * 10) / 10],
      durian: st.durian.toString(),
      eth: st.eth.toString(),
      items: Object.fromEntries(Object.entries(st.items).filter(([, v]) => v > 0n).map(([k, v]) => [k, v.toString()])),
      timesMined: st.timesMined,
      stamina: Math.round(g.stamina()),
      log: g.log().map((l) => l.text).slice(0, 4),
    };
  });
  report.steps.push({ name, note, state: s });
  console.log(name, JSON.stringify(s));
};
const wait = (ms) => page.waitForTimeout(ms);
/** Waits that cover a blockchain transaction; stretched on live networks. */
const txWait = (ms) => page.waitForTimeout(ms * SLOW);
// Software rendering runs at a few fps, so fast-forward the simulation instead of waiting.
const ff = (sec) => page.evaluate((s) => window.__game.game.advance(s), sec);
const minedAtLeast = (n) => page.waitForFunction((n) => window.__game.state()?.timesMined >= n, n, { timeout: 30000 * SLOW });
const tp = (x, z, heading) =>
  page.evaluate(([x, z, h]) => {
    window.__game.game.teleport(x, z, h);
    window.__game.game.advance(0.3); // settle camera + pick up the interaction target
  }, [x, z, heading]);

await page.goto(url);
// The Play button enables once the game server has registered the session (and the faucet drip confirmed).
await page.getByRole('button', { name: 'Play' }).and(page.locator(':not([disabled])')).waitFor({ timeout: 90000 });
await wait(1500);
await shot('01-title', 'title screen over the world');
await page.getByRole('button', { name: 'Play' }).click();
await wait(1500);
await shot('02-spawn', 'spawn, facing the statue and the mine');

// Walk forward for a bit with W.
await page.keyboard.down('w');
await ff(1.5);
await page.keyboard.up('w');
await wait(400);
await shot('03-walked', 'walked north with W');

// Mine the first copper vein.
await tp(-11, -20.3, Math.PI);
await wait(600);
await shot('04-at-vein', 'next to copper vein, prompt visible');
await page.keyboard.press('e');
await ff(0.5);
await shot('05-swinging', 'mid-swing');
await ff(0.9);
await minedAtLeast(1);
await ff(0.3);
await shot('06-mined', 'rewards floating, vein depleted');

// Mine the silver vein too.
await tp(4, -25.2, Math.PI);
await wait(400);
await page.keyboard.press('e');
await ff(1.5);
await minedAtLeast(2);

// Walk to Mang Berto and sell ore.
await tp(16.2, 3.5, Math.PI / 2);
await ff(0.5);
await shot('07-berto', 'in front of the blacksmith');
await page.keyboard.press('e');
await wait(800);
await shot('08-trade-open', 'trade window open');
// Offer every ore in the bag (first tiles of "Your bag").
const tiles = page.locator('.trade__stores section').first().locator('button.store-tile:not([disabled])');
const n = await tiles.count();
for (let i = 0; i < n; i++) await tiles.nth(0).click({ modifiers: ['Shift'] }).catch(() => {});
await wait(300);
await page.getByRole('button', { name: /Ask for .* DURIAN back/ }).click();
await wait(300);
await shot('09-trade-filled', 'ore offered, DURIAN requested, merchant ready');
await page.getByRole('button', { name: 'Accept' }).click();
await wait(300);
await shot('10-trade-confirm', 'confirm step');
await page.getByRole('button', { name: 'Confirm trade' }).click();
await txWait(3000);
await shot('11-trade-done', 'trade complete');
await page.keyboard.press('Escape');
await wait(300);

// Buy a durian from Aling Nena and eat it.
await tp(13.6, -6, 1.98);
await wait(600);
await page.keyboard.press('e');
await wait(600);
await page.locator('.trade__stores section').nth(1).locator('button.store-tile').first().click();
await page.getByRole('button', { name: /^Add .* DURIAN$/ }).click();
await wait(200);
await shot('12-nena', 'buying a durian');
await page.getByRole('button', { name: 'Accept' }).click();
await page.getByRole('button', { name: 'Confirm trade' }).click();
await txWait(3500);
await page.keyboard.press('Escape');
await wait(300);
// Eating needs room in the stamina bar. On slow networks it refills during the trades,
// so take one more swing (copper vein #1, not mined yet) before eating.
if ((await page.evaluate(() => window.__game.stamina())) >= 99) {
  const mined = await page.evaluate(() => window.__game.state().timesMined);
  await tp(-4, -23.4, Math.PI);
  await page.keyboard.press('e');
  await ff(1.5);
  await minedAtLeast(mined + 1);
  await tp(13.6, -6, 1.98);
}
const beforeEat = await page.evaluate(() => Math.round(window.__game.stamina()));
await page.keyboard.press('1');
await page.waitForFunction((b) => window.__game.stamina() > b + 10, beforeEat, { timeout: 30000 * SLOW }).catch(() => {});
await txWait(1000);
await page.keyboard.press('i');
await wait(500);
await shot('13-bag', 'bag open after eating');
await page.keyboard.press('i');

// Money changer: show the ETH side.
await tp(12.6, 12.2, 0.81);
await wait(600);
await page.keyboard.press('e');
await wait(800);
await shot('14-jun', 'money changer with ETH fields');

await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2));
console.log('failed requests', failedRequests);
console.log('console errors', errors.length, errors.filter((e) => !e.startsWith('Failed to load resource')).slice(0, 10));
await browser.close();
await server?.close();
