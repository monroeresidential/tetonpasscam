# Trailhead Restyle — Technical Design

Date: 2026-08-09. Restyles the shipped P1 app to the "Trailhead" design direction, pixel-close, per the handoff in `design/design_handoff_tetonpasscam/` (README.md = tokens/layout notes; `Teton Pass Cam.dc.html` = the mockup cards — plain inline-styled HTML, directly readable; build from cards **1a, 2a, 2b, 2d, 2e**; ignore 1b/1c/2c). The handoff folder is committed to the repo and is the visual source of truth; this doc records the decisions and the engineering shape.

## Decisions made (Drew, 2026-08-09)

| Decision | Choice |
|---|---|
| History screen (card 2c) | **Skipped** — later cycle, after the poller accrues real data |
| Camera hero slot | **Valley** ("Jackson Hole Valley") full-width 16:8; East + West half-width |
| Fonts | **Self-hosted** via @fontsource (no external requests, PWA-precached) |
| Approach | Token-first restyle of existing components; behavior/backend untouched |

## Scope

Touches only: `src/app/**`, `index.html` (shell styling + font preload if needed), `public/` (manifest colors), `vite.config.ts` (manifest theme/background colors), and app-suite tests. **Zero changes** to `src/worker/**`, `src/shared/**`, migrations, or parser/worker tests.

## Design system foundation

- **Tokens:** all Trailhead values as CSS custom properties in `src/app/index.css` under Tailwind v4 `@theme`. Light set: page `#faf7f0`; text `#2b2620`; muted `#8a8072`; faint `#b0a690`; card `#fff` border `#eae4d8`; status-open `oklch(0.55 0.13 150)`; restricted `oklch(0.62 0.13 60)`; closed `oklch(0.50 0.17 25)`; unknown `#8a8072`; delta-positive `oklch(0.50 0.13 150)`; delta-negative `oklch(0.55 0.15 30)`; accent `oklch(0.55 0.13 60)`; sponsor bg/border/label `oklch(0.95 0.03 60)` / `oklch(0.88 0.05 60)` / `oklch(0.55 0.11 60)`; primary button `#2b2620` bg white text. Dark set (overrides under `prefers-color-scheme: dark`): page `#211d17`; text `#f0ebe1`; muted `#a39880`; faint `#6e6553`; card `#2b2620` border `#3a342b`; status-open `oklch(0.45 0.11 150)`; delta-positive `oklch(0.72 0.12 150)`; delta-negative `oklch(0.72 0.14 30)`; accent `oklch(0.75 0.11 60)`; sponsor `oklch(0.30 0.03 60)` / `oklch(0.38 0.04 60)` / `oklch(0.75 0.09 60)`; primary button inverts. Radii tokens: card 14px, banner 16–18px, pill 999px. Components reference tokens only — no raw hex/oklch in TSX. Existing per-component `dark:` classes are removed as each component is restyled (dark mode comes from the token swap).
- **Fonts:** `@fontsource-variable/bricolage-grotesque` (display: headings, numerals, buttons; 700–800; letter-spacing −0.01 to −0.02em) + `@fontsource/atkinson-hyperlegible` (body 400/700), imported in index.css; tokens `--font-display`, `--font-body`. Attribution/caption-label strings use `ui-monospace` stack. Fonts ride the PWA precache (size increase acceptable; confirm total precache stays reasonable).
- **Type scale:** banner headline 40px phone / 46px desktop, weight 800; drive-time numerals 22–24px 800; section headings 15–16px 700; body 13–14px; captions 10.5–12px.
- **Shell/PWA:** index.html static SEO shell inline styles updated to token values (background, heading font once loaded); manifest `theme_color`/`background_color` → Trailhead palette (light page + dark-slate accents per mockup header). Title/meta/H1/FAQ JSON-LD strings byte-unchanged.

## Layout

- **Phone (card 1a, dark = 2b):** single column, 14px gutters, 8px card gaps. Order: header (wordmark "Teton Pass Cam" in Bricolage 19px 800 + current local time right, 11px muted) → status banner → "Drive times right now" section → "From the road" (alerts) → "Cameras" → weather strip → sponsor card → footer → fixed bottom "⚠ Report conditions" pill (primary-button tokens, min-height 48px, inset-x 14px).
- **Desktop ≥1024px (card 2a):** grid `1fr 380px`, gutters 22–28px. Right rail: cameras stacked. Left: banner, drive times, alerts, weather, sponsor, footer. Report button moves into the header (fixed pill hidden at breakpoint).

## Components (restyle only — logic, hooks, gating, contracts untouched)

- **StatusBanner:** rounded 16–18px block filled with the state color; headline Bricolage 40/46px 800: OPEN → `The pass is OPEN`; RESTRICTED → `RESTRICTED — [restriction]`; CLOSED → `Closed — do not attempt` with the existing legal sentence below (byte-identical string) + existing DetourBlock (restyled as an inner card); UNKNOWN → `UNKNOWN — check Wyoming 511` linking wyoroad.info. Sub-line "Last confirmed open 5:48 AM · WYDOT" (existing lastConfirmed data, new format). Standing advisories render as translucent pills inside the banner (`rgba(255,255,255,0.18)`, radius 999px): `Advisory: falling rock (standing)`. isStale chip and pollerDead/offline banners keep their exact current logic and strings, restyled.
- **DriveTimes:** section heading "Drive times right now" + accent "⇄ Flip direction" text button (aria-pressed preserved). Each route = white card (border, 14px radius, 12–14px padding): left name 14px 700 + sublabel 11.5px muted; right numeral 22px Bricolage 800 + verbal delta 11.5px 700. Delta copy mapping (replaces chips): diff ≤ −5min → `N min faster than usual` (delta-positive color); |diff| < 5min → `about usual` (muted); diff ≥ +5min → `N min slower than usual` (delta-negative color); N = rounded whole minutes; no delta line when typicalSec null. All 6 seeded routes render (mockup's 3 rows are the template). Sublabels: Town Square / JHMR / Airport per route destination.
- **AlertsStrip:** section retitled `From the road`. Item card: 32px rounded icon tile (`oklch(0.93 0.04 60)` light) with the type emoji; title `Slick/Ice · westbound to Victor` (type · direction phrasing); note in quotes + `· 18 min ago` age, 12px muted; `Unverified community report` 10.5px faint. Empty-state string byte-unchanged. ID-33 advisory keeps its labeled slot directly under the section heading, restyled as a muted card.
- **Cameras:** heading "Cameras". Valley hero full-width aspect 16:8; East + West half-width grid below; each tile: image, caption + **visible timestamp** (from the refreshedAt-driven cache-buster time, formatted local — closes the "cams not visibly timestamped" P1 minor), ui-monospace attribution `Imagery: WYDOT Wyoming 511.`, link + onerror fallback unchanged.
- **WeatherStrip:** four stat tiles (air / road / gust / visibility) in card style; existing winter surface-temp prominence logic kept.
- **Sponsor:** warm tinted card (sponsor tokens), label `SPONSORED BY TETON FLATS` in sponsor-label color; body copy + UTM link byte-unchanged.
- **Footer:** existing links/strings; restyled muted, small.
- **ReportModal (card 2d):** bottom sheet over dimmed backdrop, drag-handle bar, title `What are you seeing?`; 2-col type grid with emoji (Crash 💥, Slide-off 🛞, Slick/Ice ❄, Wildlife 🦌, Stopped traffic 🚗, Closure 🚧, Other full-width); selected = 2px `#2b2620` border (light) / `#f0ebe1` (dark); direction segmented pills `WB → Victor` / `EB → Jackson`; optional 140-char note; `Send report` primary pill; fine print: report doesn't change official status + rate-limit note. Honeypot, deviceId, POST body, 429 message, success toast + refresh() — all mechanically unchanged.
- **Feedback (card 2e):** heading `Tell us what's broken (or what you'd love)`, subline `Goes straight to a human in Teton Valley.`, textarea, optional email, send pill. POST contract unchanged.
- **admin.html / privacy.html:** out of scope (crude-by-design; privacy page optionally inherits page bg — one-line, allowed, not required).

## Deliberate copy/test updates — complete inventory

Update these test pins in the same task as the component change, to the new exact strings: banner headline phrasing per state (4); delta verbal copy + thresholds mapping tests; alerts section title `From the road` + item title format; camera hero order (valley first) + visible timestamp; modal title/type-grid labels/direction pill labels; feedback heading/subline. **Everything else stays frozen and must not change:** CLOSED legal sentence, empty-state string, sponsor copy/UTM, attribution string, all safety-gating tests (pollerDead × {open,restricted}, offline stale forcing, generatedAt), honeypot tests, all worker + parser suites.

## Error handling

No new error paths. Existing degradation renders (offline banner, camera onerror card, UNKNOWN states) get restyled with the same trigger logic and, where pinned, the same strings.

## Testing & verification

- All three suites green after every task; worker + parser suites must be byte-identical (no edits).
- New/updated app tests pin the new copy exactly (same discipline as P1).
- Final visual pass: Playwright screenshots at 390px (light + dark via emulation) and 1280px (light) compared against cards 1a/2b/2a side-by-side; report modal + feedback modal screenshots vs 2d/2e. Pixel-close = a human (Drew) can't spot layout/color/type deviations at a glance; exact-value tokens do the heavy lifting.
- `npm run build` clean; precache size delta reported (fonts).

## Out of scope

History screen (card 2c — future cycle once data accrues), admin page styling, backend anything, PWA icon art (separate follow-up), route set changes.
