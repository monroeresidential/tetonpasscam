import { api } from './api/router';
import type { Env } from './env';
import { runNightly } from './poller/aggregate';
import { runPollCycle } from './poller/run';

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    // Canonical-host redirect (SEO audit fix #6): www is an alias in DNS/the
    // Cloudflare custom-domain routes (wrangler.toml), not a second canonical
    // host -- collapsing it here, before any other routing, keeps exactly
    // one indexable URL per page and avoids duplicate-content signals split
    // across www/apex. 301 (permanent) since this is a durable hostname
    // decision, not a temporary redirect.
    if (url.hostname === 'www.tetonpasscam.com') {
      return Response.redirect(`https://tetonpasscam.com${url.pathname}${url.search}`, 301);
    }
    if (url.pathname.startsWith('/api/')) {
      return api.fetch(new Request(new URL(url.pathname.slice(4) + url.search, url.origin), req), env, ctx);
    }
    return env.ASSETS.fetch(req);
  },
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    // The nightly aggregation job runs on its own dedicated cron entry
    // (10 9 * * *); every other cron entry (the polling cadence, split
    // across three entries to avoid UTC midnight wraparound -- see
    // wrangler.toml) drives the regular poll cycle.
    if (event.cron === '10 9 * * *') {
      ctx.waitUntil(runNightly(env));
    } else {
      ctx.waitUntil(runPollCycle(env));
    }
  },
} satisfies ExportedHandler<Env>;
