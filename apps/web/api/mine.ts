// POST /api/mine { address, spotId } -> { voucher, stamina }
// Spends stamina and signs an EIP-712 voucher that DurianMine.mine() will accept once.
import { parseAddress, requestMine } from './_lib/game.js';
import { ipHashOf, post } from './_lib/http.js';

export const POST = post((body, request, deps) => requestMine(deps, parseAddress(body.address), body.spotId, ipHashOf(request)));
