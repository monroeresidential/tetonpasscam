# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository state

**Implemented (P1 complete as of 2026-08-09).** React + Vite + Hono-on-Workers app, deployed to Cloudflare Workers with a D1 database, per `TETONPASSCAM-SPEC.md` (still the source of truth for product intent — read it before making product decisions). See `docs/RUNBOOK.md` for deploying from scratch, launch verification, secret rotation, and other operational tasks.

### Commands

```
npm run dev             # vite build, then wrangler dev (local Worker + local D1)
npm run build            # vite build only (outputs dist/)
npm run deploy            # vite build, then wrangler deploy (real Cloudflare account required)
npm run db:generate       # drizzle-kit generate (schema -> migrations/*.sql, after editing src/worker/db/schema.ts)
                          #   NOTE: EVERY migration already applied to remote D1 is frozen -- never edit one
                          #   in place, always generate a new 000N_*.sql for the next schema change (see
                          #   docs/RUNBOOK.md §1). Deliberately stated as a rule rather than a list of
                          #   filenames: an enumerated list goes stale every time a migration lands, and a
                          #   reader who trusts a short list will edit a frozen file that isn't on it.
npm run db:migrate:local  # wrangler d1 migrations apply tetonpasscam --local
npm run test              # vitest run --config vitest.config.ts    (test/parsers/** -- WYDOT HTML parsers, no DOM/Workers runtime)
npm run test:worker       # vitest run --config vitest.workers.config.ts (test/worker/** -- Hono routes + D1, real Workers runtime via @cloudflare/vitest-pool-workers)
npm run test:app          # vitest run --config vitest.app.config.ts   (test/app/** -- React components, jsdom)
scripts/verify-launch.sh [base-url] [--skip-writes]   # curl-based DoD check against a running deploy or `wrangler dev`
```

All three test suites are separate configs (different environments: node/parsers, Workers runtime/worker, jsdom/app) rather than one `vitest.config.ts`, so the fast parser suite stays dependency-free of jsdom and the Workers runtime.

### Repo map

```
src/worker/          Cloudflare Worker (Hono) -- the only thing with DB/secret access
  index.ts             fetch()/scheduled() entrypoint; routes /api/* to Hono, everything else to ASSETS
  env.ts               Env interface (bindings + secrets)
  api/                 router.ts (mounts all routes) + status.ts, alerts.ts, feedback.ts, history.ts, admin.ts,
                       weather-history.ts
  poller/              run.ts (poll cycle orchestration), wydot-status.ts, wydot-weather.ts, google-routes.ts,
                       idaho511.ts (per-source fetch+parse), aggregate.ts (nightly typicals job),
                       nws-forecast.ts (hourly-forecast fetch + Denver-day rollup)
  db/                  schema.ts (drizzle schema), index.ts (db() helper), seed-routes.ts (ROUTES data + one-off seeder)
  notify.ts            Resend email helper (used by alerts/feedback/camera-error)
  profanity.ts         alert-note filter
  tz.ts                America/Denver weekday-class/hour/season derivation (shared by status.ts and google-routes.ts)

src/app/             React SPA (client-render only, no SSR)
  main.tsx             createRoot().render() into #root only -- never touches the static SEO shell in index.html
  App.tsx, useStatus.ts, api.ts, deviceId.ts, cameras.ts, components/
  admin.html           separate, framework-free static entry point (multi-page vite build) for the admin page

src/shared/types.ts   Types shared between worker and app (PassStatus, ApiStatus, PublicAlert, CameraId, etc.)

migrations/           drizzle-kit-generated D1 migrations. Every migration in this directory is
                      applied to remote D1 and frozen (verified 2026-08-18 via
                      `wrangler d1 migrations list tetonpasscam --remote`). Per docs/RUNBOOK.md a new
                      migration must be applied to remote BEFORE deploying the Worker that reads it.
                      (run `ls migrations/` for the current set -- listing names here only goes stale)
scripts/              verify-launch.sh, seed-routes.sql (generated from db/seed-routes.ts).
                      App icons/favicons come from design/logo-4c/ (the route-22 brand kit,
                      not generated) -- regenerate by re-copying its PNGs into public/ and
                      public/icons/ per that directory's README.
docs/                 RUNBOOK.md (ops), superpowers/ (spec + plan + SDD task artifacts)

test/
  parsers/             WYDOT HTML parser tests (pure functions, fixture-driven)
  worker/               Hono route + D1 tests (real Workers runtime)
  app/                  React component tests (jsdom)
  fixtures/             captured WYDOT/Idaho 511 HTML/JSON samples used by parser + worker tests

index.html            Vite entry + the static SEO shell (#seo-shell, sibling of #root -- see its own comment for why)
wrangler.toml          Worker config: D1 binding, [assets], cron triggers, ADMIN_EMAIL var
```

## What this is

tetonpasscam.com — a Teton Pass (WY-22) status app: official WYDOT open/closed status, live Google Routes drive times vs. historic typicals, community alerts, cams, and summit weather. Sponsored by Teton Flats (drives referrals to tetonflats.com). Target launch: before November 2026 (P1 = web/PWA; P2 = iOS/Android via Capacitor).

## Intended architecture (from the spec)

- **One codebase, three targets:** React + Vite responsive web app, wrapped later with Capacitor for iOS/Android. No SSR in app code (keep a prerendered landing shell for SEO). Keep the core UI framework-agnostic enough that `npx cap sync` works.
- **Backend:** one scheduled poller (seasonal cadence, 5–15 min, never faster than 5 min) fetches WYDOT HTML pages, Google Routes API, and Idaho 511, and writes to Cloudflare D1 (the spec's Postgres/D1 either-or was settled on D1 — see "hosting/DB vendor" below). **Clients only ever read our own API** — never WYDOT or Google directly. Public API: `GET /api/status`, `GET /api/history`, `GET/POST /api/alerts`, `POST /api/feedback`.
- **DB schema** is specified in the spec (`routes`, `travel_times`, `status_snapshots`, `weather_snapshots`, `alerts`, `feedback`). A nightly job aggregates `travel_times` into typical-by-(route, weekday-class, hour, season) medians and p25/p75.

## Hard rules (trust + liability — do not relax these)

1. **Status is four states, never a boolean:** OPEN / RESTRICTED / CLOSED / UNKNOWN. **Never default to OPEN.** Fetch errors, missing rows, unrecognized page shapes, and exhausted retries all resolve to UNKNOWN. Never report OPEN without fresh, successfully parsed data.
2. **Community alerts never change the official status banner.** Only WYDOT data drives OPEN/CLOSED. User "closure" reports display as "unconfirmed — check 511".
3. **WYDOT HTML parsing:** locate the segment row by text match on the exact string `Between Wilson and the Idaho State Line` — **never by cell index** (rowspan on Route/Town cells makes positional indexing silently wrong). A row's cell *set* also varies with its status: an elevated/closed row merges the `*cond` cell across three columns (`colspan="3"`) and omits the `*impact` and `*restrict` cells entirely, so only `*cond` + `rpttime` are invariant — requiring the full open-row shape made both parsers unable to report any closure (2026-08-18 incident; evidence and archived captures in `isCompleteDataRow`'s comment and `test/fixtures/README.md`). Primary source is `RoadClosures.html` (Closure Reason column: literal `Road Open` ⟺ open); fallback is `WRR.RoutesResults?SelectedRoute=WY22`; cross-check is `MEDIA.Statewide`. Unresolved disagreement → UNKNOWN.
4. **Never integrate the 511 map's protobuf feed** (`map.wyoroad.info/wti511map-data/*.pbf`) — obfuscated, XOR-encoded, breaks on their deploys.
5. CLOSED copy must say "Closed — do not attempt" (Wyoming closure is a legal prohibition, W.S. 24-1-109) — never "not recommended". Never display invented reopening estimates.
6. Standing advisories (e.g. `Falling Rock`, standing all summer 2026) are background state — display them, but only alert on advisory *changes*.
7. API keys (Google Routes, Idaho 511) are server-side only. Descriptive User-Agent with contact email on WYDOT fetches; 30s timeouts; respect Idaho 511's 10-calls/60s throttle (one call per cycle).
8. Staleness is surfaced independently of status (flag > ~12h, tunable by season) — show "last confirmed open at X", don't hide status when stale.

## Ask Drew (the user) before

- Changing route origins/destinations or coordinates from what's seeded in `src/worker/db/seed-routes.ts` (already finalized for P1 — Victor/Driggs ↔ Jackson/Teton Village/Airport).
- Hosting/DB vendor is decided (Cloudflare Workers + D1) — ask before switching.
- Anything requiring paid account setup or touching the live Cloudflare account/DNS (see `docs/RUNBOOK.md` and `docs/superpowers/sdd-handoff-deploy.md` for what that entails).

## Definition of done (P1, from the spec)

Deployed page passes curl checks (title/H1/meta in HTML); poller writes all four data types on schedule; killing the poller degrades the banner to UNKNOWN; `POST /api/alerts` rate-limits correctly (2/device/30min + IP throttle + honeypot); Lighthouse mobile ≥ 90.

`npx cap sync` was listed here originally but is a **P2 gate, not P1** — Capacitor has never been installed in this repo (no `@capacitor/*` dependency, no `capacitor.config.*`, nothing in any commit), so the check has never been passable and two verification passes have reported it as a failure. It belongs with the P2 iOS/Android wrap described under "Intended architecture" above. Keep the core UI framework-agnostic in the meantime so the sync is straightforward when that phase starts.
