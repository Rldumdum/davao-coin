# Davao Coin (DURIAN)

An ERC-20 memecoin, a small economy around it, and **Barangay Durian**, a 3D browser game where
every swing, bite and trade is a transaction. Built to learn smart contract engineering with
Foundry, OpenZeppelin and viem. Runs on a local chain (anvil) or Base Sepolia. Testnets only, never mainnet.

**Play it: https://davao-coin.vercel.app** (Base Sepolia testnet; no wallet or crypto needed, your
browser gets a session wallet and the game's faucet pays its gas).

| | |
|---|---|
| Name | Davao Coin |
| Ticker | DURIAN |
| Decimals | 18 |
| Supply | 1,000,000,000 (fixed, minted once at deployment) |

## Layout

```
contracts/                 Foundry project
  src/                     the contracts (table below)
  test/                    unit + fuzz tests (forge test)
  script/DeployBase.s.sol  everything both deployments share
  script/DeployLocal.s.sol anvil: + sample people, anvil test keys
  script/Deploy.s.sol      Base Sepolia: keys from env, refuses non-testnets
  deployments/<chainId>.json  addresses written by the deploy scripts (committed)
apps/web/                  the Vercel project: Vite + React + three.js, plus serverless API
  src/                     browser code
    lib/                   infrastructure: network, session wallet, formatting
    services/              every chain read/write and API call the UI makes
    game/engine/           three.js world, characters, game loop (knows nothing about the chain)
    game/hooks/            game state: chain polling, stamina, session, actions, tx log
    game/hud/              status bar, trade window, bag, minimap
    components/            the original dashboard's panels (#/dashboard)
  api/                     Vercel Functions: session.ts, mine.ts, eat.ts
    _lib/                  server code: config (all secrets), rules (game.ts), stores, chain
  shared/                  imported by BOTH browser and API: rules, networks, voucher types,
                           API types, and generated ABIs + addresses (committed)
  scripts/                 sync-contracts, playtest, copycat-bot
supabase/migrations/       game server tables + atomic stamina functions
```

## Contracts

| Contract | What it does | Patterns it teaches |
|---|---|---|
| `DavaoCoin` | The token | Inheriting OpenZeppelin ERC20, fixed supply |
| `DavaoBank` | Deposit, withdraw, transfer between bank accounts | approve → transferFrom, checks-effects-interactions, ledger invariants |
| `PuzzleRewards` | Solve a puzzle, get DURIAN | Hash commitments, access control, a **deliberate** front-running weakness |
| `DurianMarket` | Sell DURIAN for ETH, buy other people's offers | Escrow, pull payments, reentrancy guards |
| `DavaoItems` | Every game item: ores, fruit, pickaxes | ERC-1155 multi-token, roles (AccessControl), burning |
| `DurianMine` | Swing at a spot with a server-signed voucher, get DURIAN + ore | EIP-712 signatures, replay protection, per-player cooldowns |
| `Merchant` | NPC trader: swaps bundles of DURIAN/ETH/items in one tx | Atomic swaps, bid/ask spreads, rounding in the house's favor |

### Deployed on Base Sepolia (chain 84532)

| Contract | Address |
|---|---|
| DavaoCoin | [0xe1bf1382D539976073B55805417890143242E33b](https://sepolia.basescan.org/address/0xe1bf1382D539976073B55805417890143242E33b) |
| DavaoItems | [0xf0374C6B0D8b7850c439dE3B68CD914792838FDc](https://sepolia.basescan.org/address/0xf0374C6B0D8b7850c439dE3B68CD914792838FDc) |
| DurianMine | [0xE3aFb2125F44c60f22f546294071344869734461](https://sepolia.basescan.org/address/0xE3aFb2125F44c60f22f546294071344869734461) |
| Merchant: Aling Nena | [0xe2Be65c99719cc3E81C6556a66fCc36D3Fc7DCC9](https://sepolia.basescan.org/address/0xe2Be65c99719cc3E81C6556a66fCc36D3Fc7DCC9) |
| Merchant: Mang Berto | [0xF2546173C08935c1b0500f01a4e1ecB71a7385A5](https://sepolia.basescan.org/address/0xF2546173C08935c1b0500f01a4e1ecB71a7385A5) |
| Merchant: Kuya Jun | [0x5d3F1A3A5E8c562E4808883546524B1094224010](https://sepolia.basescan.org/address/0x5d3F1A3A5E8c562E4808883546524B1094224010) |
| DavaoBank | [0xE0C7f1F1289D08aE797a890eD1C3964DE5B9D45F](https://sepolia.basescan.org/address/0xE0C7f1F1289D08aE797a890eD1C3964DE5B9D45F) |
| DurianMarket | [0xB5Ae8ADc94A8695424c6c1159321DDe3537969cC](https://sepolia.basescan.org/address/0xB5Ae8ADc94A8695424c6c1159321DDe3537969cC) |
| PuzzleRewards | [0xab96b91392Fd04d207918e9630BC7a1038bB6c3A](https://sepolia.basescan.org/address/0xab96b91392Fd04d207918e9630BC7a1038bB6c3A) |

Source isn't verified on Basescan yet (needs an Etherscan API key; see the deploy section).

## How the game is wired

```
browser (session wallet)          game API (Vercel Functions)          chain
────────────────────────          ───────────────────────────          ─────
POST /api/session  ─────────────▶ register player, faucet drip ──────▶ ETH for gas
POST /api/mine     ─────────────▶ stamina + rate limits OK?
                   ◀───────────── EIP-712 voucher (signed)
mine(spot, voucher) ───────────────────────────────────────────────▶ DurianMine checks signature
burn(fruit)        ────────────────────────────────────────────────▶ DavaoItems
POST /api/eat {tx} ─────────────▶ reads the burn from the chain, credits stamina
trade(give, take)  ────────────────────────────────────────────────▶ Merchant (atomic swap)
```

- **Session wallet**: a key generated in the browser and kept in localStorage, so a transaction
  per swing doesn't mean a wallet popup per swing. It holds only testnet play money; anything that
  can run script on the page could read it.
- **Vouchers**: the contract can't know you walked to the rock, so the server decides (stamina,
  per-IP and per-day limits) and signs; the contract verifies. A voucher names its miner, spot,
  id and a 2-minute deadline, so it can't be stolen from the mempool or replayed.
- **Supabase** stores players' stamina, issued vouchers, faucet drips and meals. Only the API
  touches it, with the service-role key; RLS is on with no policies, so the public anon key
  can do nothing.

## Run it locally

Needs Foundry and Node 20+. No accounts, keys or database: the local API uses anvil's public
test keys and an in-memory store.

```
# terminal 1, in contracts/   (local chain, empty every start)
anvil

# terminal 2, in contracts/   (deploy + seed sample people; prints addresses)
forge script script/DeployLocal.s.sol --rpc-url local --broadcast

# terminal 3, in apps/web/    (game + API at http://localhost:5192)
npm install        # first time only
npm run dev
```

The game is at `/`, the original dashboard at `/#/dashboard`. Restarted anvil? Deploy again
(addresses come out the same). If forge says the previous broadcast "has unfinished operations",
add `--start-fresh`.

## Deploy: Base Sepolia + Supabase + Vercel

1. **Keys** (testnet only). Make three fresh wallets: `cast wallet new` ×3, for the **deployer**,
   the **voucher signer** and the **faucet**. Fund the deployer and faucet with Base Sepolia ETH
   from a faucet (the deployer needs ~0.02 ETH, which includes 0.01 for Kuya Jun's till).
2. **Contracts**. In `contracts/`: `cp .env.example .env`, fill in `DEPLOYER_PRIVATE_KEY`,
   `VOUCHER_SIGNER` (the signer's *address*), `BASESCAN_API_KEY`, then
   ```
   source .env
   forge script script/Deploy.s.sol --rpc-url base_sepolia --broadcast --verify
   ```
   This writes `deployments/84532.json`. In `apps/web/`: `npm run sync`, then commit `shared/`.
3. **Database**. Create a Supabase project and run `supabase/migrations/*.sql` (SQL editor, or
   `supabase link --project-ref <ref> && supabase db push`).
4. **Vercel**. Import the repo, set **Root Directory = `apps/web`**, and add the variables from
   [`apps/web/.env.example`](apps/web/.env.example): `VITE_NETWORK` and `NETWORK` = `base-sepolia`,
   `VOUCHER_SIGNER_KEY`, `FAUCET_PRIVATE_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `IP_HASH_SALT`.
   Deploy.

Secrets never go in git: `.env*` files are ignored (only `.env.example` templates are committed),
and only `VITE_`-prefixed variables reach the browser.

## Attack demo: front-running the puzzles

`apps/web/scripts/copycat-bot.ts` watches the mempool, reads puzzle answers out of other people's
pending `solve()` transactions, and resubmits them with a higher tip so it gets mined first.

```
# after the local setup above, make blocks every 5 seconds so transactions wait in the mempool
cast rpc evm_setIntervalMining 5 --rpc-url http://127.0.0.1:8545

# in apps/web/
npm run attack:copycat
```

Solve a puzzle in the dashboard and watch the bot claim the same reward first. `DurianMine`
doesn't have this bug: its vouchers name the miner, so a copied one is useless.

## Commands

```
# contracts/
forge test                   # 66 tests incl. fuzz
forge test -vvvv             # full call traces when something fails

# apps/web/
npm run typecheck
npm test                     # game server rules (stamina, vouchers, faucet limits, meals)
npm run build
npm run sync                 # after changing or redeploying contracts; commit shared/
npm run playtest             # headless game run against a throwaway chain on :8546 (see script header)
```

CI (`.github/workflows/test.yml`) runs all of it, and fails if `shared/` is stale.

## Roadmap

1. ~~Fixed-supply ERC-20~~
2. ~~Local deployment, bank, puzzles, market, UI~~
3. ~~3D game: items (ERC-1155), mining, NPC merchants~~
4. ~~Server-signed EIP-712 mining vouchers, session wallets, game API, Supabase~~
5. ~~**Testnet launch** on Base Sepolia + Vercel~~ (live at https://davao-coin.vercel.app)  <- you are here
6. Fix the puzzles' front-running (commit-reveal, or vouchers like the mine)
7. Optional real wallet (wagmi + MetaMask) to withdraw winnings from a session wallet
8. Airdrop claim with a Merkle tree
