import { api } from './api/router';
import type { Env } from './env';
import { runNightly } from './poller/aggregate';
import { runPollCycle } from './poller/run';

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/api/')) {
      return api.fetch(new Request(new URL(url.pathname.slice(4) + url.search, url.origin), req), env, ctx);
    }
    return env.ASSETS.fetch(req);
  },
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    // The nightly aggregation job runs on its own dedicated cron entry
    // (10 9 * * *); every other cron entry (the 10-minute polling cadence,
    // split across two entries to avoid UTC midnight wraparound -- see
    // wrangler.toml) drives the regular poll cycle.
    if (event.cron === '10 9 * * *') {
      ctx.waitUntil(runNightly(env));
    } else {
      ctx.waitUntil(runPollCycle(env));
    }
  },
} satisfies ExportedHandler<Env>;
