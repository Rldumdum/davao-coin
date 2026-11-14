import { defineConfig, loadEnv, type Plugin, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Local stand-in for Vercel Functions: serves api/<name>.ts at /api/<name> during `vite dev`,
 * calling the same Web-standard `POST(request)` export Vercel calls in production.
 * One code path for both, and no `vercel dev` / Vercel login needed to work locally.
 */
function devApi(): Plugin {
  return {
    name: 'davao-dev-api',
    configureServer(server: ViteDevServer) {
      // Server-side env (no VITE_ prefix) for the API code, from .env / .env.local.
      Object.assign(process.env, loadEnv(server.config.mode, process.cwd(), ''));

      server.middlewares.use('/api', async (req: IncomingMessage, res: ServerResponse) => {
        const name = (req.url ?? '').split('?')[0]!.replace(/^\/+|\/+$/g, '');
        if (!/^[a-z-]+$/.test(name)) {
          res.statusCode = 404;
          return res.end();
        }
        try {
          const mod = (await server.ssrLoadModule(`/api/${name}.ts`)) as Record<string, (r: Request) => Promise<Response>>;
          const handler = mod[req.method ?? 'GET'];
          if (!handler) {
            res.statusCode = 405;
            return res.end();
          }
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk as Buffer);
          const headers = new Headers();
          for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
          if (!headers.has('x-forwarded-for')) headers.set('x-forwarded-for', req.socket.remoteAddress ?? 'local');
          const response = await handler(
            new Request(`http://localhost/api/${name}`, {
              method: req.method,
              headers,
              body: chunks.length ? Buffer.concat(chunks) : undefined,
            }),
          );
          res.statusCode = response.status;
          response.headers.forEach((v, k) => res.setHeader(k, v));
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch (err) {
          server.config.logger.error(`[api/${name}] ${(err as Error).stack ?? err}`);
          res.statusCode = 500;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ error: 'server_error', message: (err as Error).message }));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), devApi()],
});
