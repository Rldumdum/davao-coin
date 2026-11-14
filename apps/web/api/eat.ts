// POST /api/eat { address, txHash } -> { stamina }
// Credits stamina for fruit the player burned on-chain, after reading the receipt itself.
import { eat, parseAddress } from './_lib/game.js';
import { post } from './_lib/http.js';

export const POST = post((body, _request, deps) => eat(deps, parseAddress(body.address), body.txHash));
