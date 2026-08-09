import { api } from './api/router';
import type { Env } from './env';

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/api/')) {
      return api.fetch(new Request(new URL(url.pathname.slice(4) + url.search, url.origin), req), env, ctx);
    }
    return env.ASSETS.fetch(req);
  },
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    // dispatcher filled in Task 8
  },
} satisfies ExportedHandler<Env>;
