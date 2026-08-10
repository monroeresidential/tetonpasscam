# tetonpasscam.com

**Is Teton Pass open, and how long will the drive take right now?**

**Live at [tetonpasscam.com](https://tetonpasscam.com)** since August 2026. A Teton Pass (WY-22) status app for Teton Valley ↔ Jackson commuters: official WYDOT open/closed status, live drive times with "vs. typical" comparisons, community road reports, the three pass cameras, and summit weather — in one screen, built to be checked every morning at 6am in January.

Sponsored by [Teton Flats](https://tetonflats.com). Not affiliated with WYDOT — always confirm closures with [Wyoming 511](https://www.wyoroad.info).

## What it does

- **Status banner** — four states (`OPEN` / `RESTRICTED` / `CLOSED` / `UNKNOWN`), driven exclusively by WYDOT data. Never defaults to open: every fetch error, parse failure, or stale feed degrades to UNKNOWN. Closures display as the legal prohibitions they are (W.S. 24-1-109).
- **Live drive times** — Victor/Driggs ↔ Jackson Town Square, Teton Village, and the airport via Google Routes (traffic-aware), compared against our own historic typicals once two weeks of data accrue.
- **Community alerts** — two-tap anonymous reports (crash, slick, wildlife…), auto-expiring, rate-limited, and always labeled "Unverified community report." Community reports never change the official status.
- **Cameras** — the three WY-22 views (valley / east / west), refreshed with the data poll. Imagery: WYDOT Wyoming 511.
- **Summit weather** — air and road-surface temps, wind gusts, and visibility from the Teton Pass RWIS station, with WYDOT's own report time and staleness flagged honestly.
- **Share cards** — the Share button mints a timestamped link (`/s/20261215-0630`, Mountain time) whose social preview is a server-rendered image of that moment's status and drive times. Recipients see OPEN/CLOSED from the picture alone; each card carries its "as of" time so an old share can never pose as current.
- **PWA** — installable (Route-22 marker icon, adaptive light/dark), with an offline shell that shows last-known status and refuses to present stale data as current.
- **Crawler-honest HTML** — live status, weather, and a drive time are injected into the served HTML at the edge, so search engines, link unfurlers, and AI answer engines see current conditions without executing JavaScript; the same HTML goes to every requester.

## How it works

One Cloudflare Worker does everything:

```
cron (every 10 min) ─→ poller ─→ WYDOT HTML (primary + fallback + crosscheck, weather) ─┐
                                 Google Routes API (12 route-directions)                ─┼─→ D1 (SQLite)
                                 Idaho 511 API (ID-33 approach events)                  ─┘
                                          │
browser / PWA ←── static assets + /api/* ─┤   (clients only ever read our API)
crawlers      ←── live status in the HTML ─┤   (HTMLRewriter edge injection, 5-min cache)
share links   ←── /s/{code} + /og/{code}.png ─┘ (satori+resvg PNG cards rendered at the edge)
nightly cron ─→ aggregates travel times into typicals (rolling year); prunes old snapshots
```

- **Backend:** [Hono](https://hono.dev) on Cloudflare Workers (Paid plan, `run_worker_first`), Cloudflare D1 via Drizzle ORM, cron triggers for the poller and nightly aggregation, Resend for admin notifications, Google Analytics 4 on the frontend.
- **Frontend:** React + Vite + Tailwind v4 (token-driven "Trailhead" design, dark-mode via `prefers-color-scheme`), client-rendered with a static SEO shell + visible FAQ, `vite-plugin-pwa` for installability/offline.
- **Status parsing:** WYDOT publishes no JSON API, so the poller parses their HTML — primary and fallback pages are both fetched **every cycle** and cross-checked through an explicit agreement matrix (Statewide page as tiebreaker); row location by text match (never cell position), classification biased toward UNKNOWN on any ambiguity, and a hard invariant that a definitive "closed" from either page can never yield OPEN.
- **Abuse resistance:** atomic single-statement rate limits, honeypot with response parity, salted identifier hashing, request-body size caps, timing-safe admin auth.

## Development

```bash
cp .dev.vars.example .dev.vars   # dummy secrets for local dev + worker tests
npm ci
npm run db:migrate:local         # apply migrations to local D1
npm run dev                      # build + wrangler dev at localhost:8787
```

Tests (three suites, three environments):

```bash
npm test                # WYDOT parsers (node, fixture-driven)
npm run test:worker     # API routes + poller against real local D1 (Workers runtime)
npm run test:app        # React components (jsdom)
```

`scripts/verify-launch.sh [base-url]` runs the launch acceptance checks against any running deployment.

## Deploying

See **[docs/RUNBOOK.md](docs/RUNBOOK.md)** — provisioning from scratch, secrets (`GOOGLE_ROUTES_KEY`, `IDAHO_511_KEY`, `RESEND_KEY`, `ADMIN_TOKEN`), migration rules, backups, and operational drills.

## Repo map

```
src/worker/    Hono API + poller + share-card renderer + D1 schema (the only code with DB/secret access)
src/app/       React SPA + static admin page
src/shared/    Types + legal copy shared across the boundary
design/        Route-22 brand kits (light/dark) + the Trailhead design handoff
migrations/    D1 migrations (applied ones are frozen — see RUNBOOK)
test/          parsers / worker / app suites + captured WYDOT HTML fixtures
docs/          RUNBOOK, content roadmap, specs and plans, verification screenshots
```

More detail in [CLAUDE.md](CLAUDE.md), including the project's hard rules (the never-false-OPEN invariants, parsing constraints, and copy requirements).

## Data sources & credits

- Road status, weather, and imagery: [WYDOT / Wyoming 511](https://www.wyoroad.info) (parsed respectfully: descriptive User-Agent, ≥10-minute cadence, 30s timeouts)
- Idaho approach events: [Idaho 511 API](https://511.idaho.gov/developers/doc)
- Drive times: Google Routes API
- Not affiliated with WYDOT or the State of Wyoming. During a closure, the road is legally closed — do not attempt.
