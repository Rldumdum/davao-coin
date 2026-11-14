// POST /api/session { address } -> { stamina, drip }
// Registers the player and tops up a brand-new session wallet with gas money.
import { parseAddress, startSession } from './_lib/game.js';
import { ipHashOf, post } from './_lib/http.js';

export const POST = post((body, request, deps) => startSession(deps, parseAddress(body.address), ipHashOf(request)));
