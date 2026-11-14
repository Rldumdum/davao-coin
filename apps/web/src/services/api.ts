// Typed client for the game API (apps/web/api). Request/response types come from shared/api.ts,
// the same file the server uses, so the two can't drift apart silently.
import type {
  ApiError,
  EatRequest,
  EatResponse,
  MineRequest,
  MineResponse,
  SessionRequest,
  SessionResponse,
} from '../../shared/api';

export class ApiCallError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiError,
  ) {
    super(body.message);
  }
}

async function call<Req, Res>(path: string, body: Req): Promise<Res> {
  const res = await fetch(`/api/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => null)) as Res | ApiError | null;
  if (!res.ok || data === null) {
    throw new ApiCallError(res.status, (data as ApiError | null) ?? { error: 'server_error', message: `API ${path} failed (${res.status})` });
  }
  return data as Res;
}

export const api = {
  session: (body: SessionRequest) => call<SessionRequest, SessionResponse>('session', body),
  mine: (body: MineRequest) => call<MineRequest, MineResponse>('mine', body),
  eat: (body: EatRequest) => call<EatRequest, EatResponse>('eat', body),
};
