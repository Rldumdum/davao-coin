// The HTTP edge: turns a Web Request into a call to the game logic and back.
// Handlers use the Web-standard (Request) => Response signature that Vercel Functions support,
// and that our Vite dev plugin calls directly in local development.
import { createHash, randomBytes } from 'node:crypto';
import type { ApiError } from '../../shared/api.js';
import { createChainPort } from './chain.js';
import { loadConfig } from './config.js';
import { ApiFailure, type Deps } from './game.js';
import { MemoryStore } from './store.js';
import { SupabaseStore } from './store-supabase.js';

let deps: Deps | null = null;

/** Built once per function instance (cold start), then reused. */
export function getDeps(): Deps {
  if (deps) return deps;
  const config = loadConfig();
  deps = {
    config,
    chain: createChainPort(config),
    store: config.supabase ? new SupabaseStore(config.supabase.url, config.supabase.serviceRoleKey) : new MemoryStore(),
    now: () => Date.now(),
    randomId: () => BigInt(`0x${randomBytes(32).toString('hex')}`),
  };
  return deps;
}

/** We rate-limit by IP but never store one: only a salted hash. */
export function ipHashOf(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const ip = forwarded || request.headers.get('x-real-ip') || 'unknown';
  return createHash('sha256').update(`${loadConfig().ipHashSalt}:${ip}`).digest('hex').slice(0, 32);
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

/** Wraps a POST handler: parses the JSON body, maps ApiFailure to its status, hides crashes. */
export function post<T>(handle: (body: Record<string, unknown>, request: Request, deps: Deps) => Promise<T>) {
  return async (request: Request): Promise<Response> => {
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
      if (typeof body !== 'object' || body === null) throw new Error();
    } catch {
      return json(400, { error: 'bad_request', message: 'Body must be a JSON object.' } satisfies ApiError);
    }
    try {
      return json(200, await handle(body, request, getDeps()));
    } catch (err) {
      if (err instanceof ApiFailure) {
        return json(err.status, { error: err.code, message: err.message, stamina: err.stamina } satisfies ApiError);
      }
      console.error(err); // shows up in Vercel's function logs; never sent to the client
      return json(500, { error: 'server_error', message: 'Something went wrong on our side.' } satisfies ApiError);
    }
  };
}
