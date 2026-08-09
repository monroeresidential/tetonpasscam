# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository state

**Pre-implementation.** This repo currently contains only `TETONPASSCAM-SPEC.md` — the full product spec plus a build prompt at the bottom. Read that file before doing anything; it is the source of truth. There is no build system, test suite, or code yet. Once implementation starts, update this file with the actual commands.

## What this is

tetonpasscam.com — a Teton Pass (WY-22) status app: official WYDOT open/closed status, live Google Routes drive times vs. historic typicals, community alerts, cams, and summit weather. Sponsored by Teton Flats (drives referrals to tetonflats.com). Target launch: before November 2026 (P1 = web/PWA; P2 = iOS/Android via Capacitor).

## Intended architecture (from the spec)

- **One codebase, three targets:** React + Vite responsive web app, wrapped later with Capacitor for iOS/Android. No SSR in app code (keep a prerendered landing shell for SEO). Keep the core UI framework-agnostic enough that `npx cap sync` works.
- **Backend:** one scheduled poller (seasonal cadence, 5–15 min, never faster than 5 min) fetches WYDOT HTML pages, Google Routes API, and Idaho 511, and writes to Postgres/D1. **Clients only ever read our own API** — never WYDOT or Google directly. Public API: `GET /api/status`, `GET /api/history`, `GET/POST /api/alerts`, `POST /api/feedback`.
- **DB schema** is specified in the spec (`routes`, `travel_times`, `status_snapshots`, `weather_snapshots`, `alerts`, `feedback`). A nightly job aggregates `travel_times` into typical-by-(route, weekday-class, hour, season) medians and p25/p75.

## Hard rules (trust + liability — do not relax these)

1. **Status is four states, never a boolean:** OPEN / RESTRICTED / CLOSED / UNKNOWN. **Never default to OPEN.** Fetch errors, missing rows, unrecognized page shapes, and exhausted retries all resolve to UNKNOWN. Never report OPEN without fresh, successfully parsed data.
2. **Community alerts never change the official status banner.** Only WYDOT data drives OPEN/CLOSED. User "closure" reports display as "unconfirmed — check 511".
3. **WYDOT HTML parsing:** locate the segment row by text match on the exact string `Between Wilson and the Idaho State Line` — **never by cell index** (rowspan on Route/Town cells makes positional indexing silently wrong). Primary source is `RoadClosures.html` (Closure Reason column: literal `Road Open` ⟺ open); fallback is `WRR.RoutesResults?SelectedRoute=WY22`; cross-check is `MEDIA.Statewide`. Unresolved disagreement → UNKNOWN.
4. **Never integrate the 511 map's protobuf feed** (`map.wyoroad.info/wti511map-data/*.pbf`) — obfuscated, XOR-encoded, breaks on their deploys.
5. CLOSED copy must say "Closed — do not attempt" (Wyoming closure is a legal prohibition, W.S. 24-1-109) — never "not recommended". Never display invented reopening estimates.
6. Standing advisories (e.g. `Falling Rock`, standing all summer 2026) are background state — display them, but only alert on advisory *changes*.
7. API keys (Google Routes, Idaho 511) are server-side only. Descriptive User-Agent with contact email on WYDOT fetches; 30s timeouts; respect Idaho 511's 10-calls/60s throttle (one call per cycle).
8. Staleness is surfaced independently of status (flag > ~12h, tunable by season) — show "last confirmed open at X", don't hide status when stale.

## Ask Drew (the user) before

- Finalizing route origins/destinations and exact coordinates for drive-time routes.
- Choosing the hosting/DB vendor.
- Anything requiring paid account setup.

## Definition of done (P1, from the spec)

Deployed page passes curl checks (title/H1/meta in HTML); poller writes all four data types on schedule; killing the poller degrades the banner to UNKNOWN; `POST /api/alerts` rate-limits correctly (2/device/30min + IP throttle + honeypot); Lighthouse mobile ≥ 90; `npx cap sync` runs cleanly.
