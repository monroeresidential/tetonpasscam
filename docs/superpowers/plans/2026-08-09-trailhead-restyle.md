# Trailhead Restyle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the shipped P1 app to the "Trailhead" design (pixel-close) without touching any backend, contract, or safety behavior.

**Architecture:** Token-first: all Trailhead colors/type/radii become Tailwind v4 `@theme` CSS custom properties in `src/app/index.css` (light + dark), fonts self-hosted via @fontsource, then each component is restyled in place against its mockup card. Spec: `docs/superpowers/specs/2026-08-09-trailhead-restyle-design.md`. Mockup: `design/design_handoff_tetonpasscam/Teton Pass Cam.dc.html` — cards at lines **2a:16, 2b:69, 2d:174, 2e:202, 1a:222** (plain inline-styled HTML — READ the card before styling its component; the inline styles ARE the spec values). Ignore cards 2c/1b/1c.

**Tech Stack:** Existing React 19 + Vite + Tailwind v4; adds `@fontsource-variable/bricolage-grotesque`, `@fontsource/atkinson-hyperlegible`. Playwright (already a plugin dependency of the harness — if unavailable as npm module, use `npx playwright` via the final task's instructions) for the visual pass.

## Global Constraints

- **Scope fence:** only `src/app/**`, `index.html`, `index.css` (lives at src/app/index.css), `vite.config.ts` (manifest colors ONLY), `package.json` (font deps ONLY), app tests (`test/app/**`). `src/worker/**`, `src/shared/**`, `migrations/**`, `test/parsers/**`, `test/worker/**` must be byte-untouched — parser+worker suites must pass with zero edits.
- **Frozen strings (byte-exact, re-verify their tests still pass unmodified):** CLOSED legal sentence `Closed — do not attempt. Traveling a closed Wyoming road is illegal (up to $750 fine).`; empty state `No reports in the last 3 hours.`; label `Unverified community report`; sponsor copy `Sponsored by Teton Flats — modern 1 & 2 bed apartments in Victor, 35 minutes from Jackson. Live here, check this page less.` + UTM URL; attribution `Imagery: WYDOT Wyoming 511.`; index.html title/meta/H1/JSON-LD.
- **Frozen behavior:** pollerDead/isStale/offline gating, generatedAt forcing, honeypot mechanics, deviceId, 429 handling, refresh-on-submit, camera onerror + beacon, flip toggle semantics, all fetch shapes. Restyle = markup/classes/copy only where the spec's inventory says so.
- Tokens only in TSX — no raw hex/oklch in components; everything through `@theme` custom properties. Remove per-component `dark:` classes as each component is restyled.
- New/changed copy pinned by exact-string tests, same discipline as P1.
- All three suites green at every task's end; `npm run build` clean.
- Commits conventional style + trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## File Structure (locked)

```
src/app/index.css      @theme tokens (light) + dark override block + @fontsource imports
src/app/App.tsx        header, phone order, desktop grid, report-button placement
src/app/components/*.tsx   restyled in place (no renames, no new components except Header.tsx)
src/app/components/Header.tsx   NEW: wordmark + local time + (desktop) report button slot
test/app/*             updated pins per spec inventory + new Header/layout tests
index.html             shell inline styles → token values
vite.config.ts         manifest theme_color/background_color
```

---

### Task 1: Token system + fonts + shell/manifest colors

**Files:**
- Modify: `src/app/index.css`, `index.html` (inline styles in the `<style>`/shell markup only — NOT the pinned title/meta/H1/JSON-LD), `vite.config.ts` (manifest colors), `package.json` (add font deps)
- Test: `test/parsers/index-html.test.ts` must still pass UNCHANGED; `test/app/tokens.test.ts` (new, small)

**Interfaces:**
- Produces (all later tasks consume): CSS custom properties, exact names: `--color-page`, `--color-ink`, `--color-muted`, `--color-faint`, `--color-card`, `--color-card-border`, `--color-status-open`, `--color-status-restricted`, `--color-status-closed`, `--color-status-unknown`, `--color-delta-pos`, `--color-delta-neg`, `--color-accent`, `--color-sponsor-bg`, `--color-sponsor-border`, `--color-sponsor-label`, `--color-btn-bg`, `--color-btn-ink`, `--radius-card` (14px), `--radius-banner` (18px), `--font-display`, `--font-body`. Tailwind v4 `@theme` exposes these as utilities (`bg-page`, `text-ink`, `rounded-card`, `font-display`, etc.).

- [ ] **Step 1:** `npm i @fontsource-variable/bricolage-grotesque @fontsource/atkinson-hyperlegible`
- [ ] **Step 2:** Rewrite `src/app/index.css`: font imports (`@import '@fontsource-variable/bricolage-grotesque';` + atkinson 400 & 700 css files), then `@theme { ... }` with the LIGHT values verbatim from spec §Design system foundation (page #faf7f0, ink #2b2620, muted #8a8072, faint #b0a690, card #fff, card-border #eae4d8, status-open oklch(0.55 0.13 150), status-restricted oklch(0.62 0.13 60), status-closed oklch(0.50 0.17 25), status-unknown #8a8072, delta-pos oklch(0.50 0.13 150), delta-neg oklch(0.55 0.15 30), accent oklch(0.55 0.13 60), sponsor oklch(0.95 0.03 60)/oklch(0.88 0.05 60)/oklch(0.55 0.11 60), btn #2b2620/#fff, radii 14/18px, font-display 'Bricolage Grotesque Variable', font-body 'Atkinson Hyperlegible'), then a `@media (prefers-color-scheme: dark) { :root { ... } }` block overriding the custom properties with the DARK set from the spec (page #211d17, ink #f0ebe1, muted #a39880, faint #6e6553, card #2b2620, card-border #3a342b, status-open oklch(0.45 0.11 150), delta-pos oklch(0.72 0.12 150), delta-neg oklch(0.72 0.14 30), accent oklch(0.75 0.11 60), sponsor oklch(0.30 0.03 60)/oklch(0.38 0.04 60)/oklch(0.75 0.09 60), btn #f0ebe1/#211d17). Set `body { background: var(--color-page); color: var(--color-ink); font-family: var(--font-body); }`.
- [ ] **Step 3:** index.html: update the static shell's inline styles (background, font-family fallbacks, muted colors) to the literal light values (the shell renders pre-CSS-load; keep values hardcoded there but matching). DO NOT touch title/meta/H1 text or JSON-LD.
- [ ] **Step 4:** vite.config.ts manifest: `theme_color: '#2b2620'`, `background_color: '#faf7f0'`.
- [ ] **Step 5:** New `test/app/tokens.test.ts`: reads `src/app/index.css` as text (import ?raw or fs) and asserts the exact token values for the safety-relevant colors (status-open/restricted/closed/unknown light + dark status-open) — pins the palette against drift.
- [ ] **Step 6:** Run ALL suites + `npm run build`; app suite must be green (existing components still work on old classes — Tailwind still generates them until removed); `test/parsers/index-html.test.ts` unchanged and green. Record precache size delta from the build output (fonts).
- [ ] **Step 7:** Commit `"feat(restyle): trailhead tokens, self-hosted fonts, shell+manifest colors"`.

---

### Task 2: Header + layout (phone order, desktop grid, report-button placement)

**Files:**
- Create: `src/app/components/Header.tsx`, `test/app/Header.test.tsx`
- Modify: `src/app/App.tsx`, `src/app/components/ReportModal.tsx` (ONLY the trigger-button rendering — accept an optional `renderTrigger?: 'fixed' | 'inline'` prop or export the open-control so the header can host a button; keep the modal itself untouched this task), `test/app/App.test.tsx` (layout assertions only — the submit-refetch test must keep passing unmodified)

**Interfaces:**
- Consumes: tokens from Task 1.
- Produces: `Header({ onReport }: { onReport: () => void })` — wordmark `Teton Pass Cam` (font-display, 19px, 800), right side: local time (11px, muted, format `Sat 6:12 AM` via `toLocaleString` weekday short + h:mm AM) on phone; on desktop also an inline `⚠ Report conditions` button calling `onReport`. `ReportModal` gains `open`/`onOpenChange`-style external control OR keeps internal state but exposes trigger placement via prop — implementer chooses the minimal refactor, documents it, and MUST NOT alter submit/honeypot/429 logic.

- [ ] **Step 1 (RED):** Header tests — renders wordmark exactly `Teton Pass Cam`; renders a time matching `/[A-Z][a-z]{2} \d{1,2}:\d{2} (AM|PM)/`; desktop variant renders the report button (jsdom: pass a `variant` or assert both render paths as the implementer designs them).
- [ ] **Step 2:** Implement Header; wire into App above the banner. App layout: phone = single column (max-w ~30rem centered, 14px gutters, 8px gaps, order: header, banner, drive times, alerts, cameras, weather, sponsor, footer, fixed report pill); desktop ≥1024px = `lg:grid lg:grid-cols-[1fr_380px] lg:gap-7` with cameras in the right column (`lg:col-start-2 lg:row-span-full` pattern or explicit two-wrapper layout — implementer picks, documents) and the fixed pill hidden (`lg:hidden`), header button visible (`hidden lg:inline-flex`).
- [ ] **Step 3:** App.test.tsx additions: cameras section exists once (not duplicated by the grid restructure); report trigger present (fixed pill in default jsdom). Existing tests (submit→refetch, offline banner) run UNMODIFIED.
- [ ] **Step 4 (GREEN):** `npm run test:app` all green; other suites untouched-green; build clean.
- [ ] **Step 5:** Commit `"feat(restyle): trailhead header + phone/desktop layout"`.

---

### Task 3: StatusBanner + DetourBlock

**Files:**
- Modify: `src/app/components/StatusBanner.tsx`, `src/app/components/DetourBlock.tsx`, `test/app/StatusBanner.test.tsx`

**Interfaces:**
- Consumes: tokens; card 1a lines 222–233 (banner block) + spec §Components.StatusBanner.
- Produces: no API change (`data: ApiStatus` prop unchanged).

- [ ] **Step 1 (RED):** Update headline pins: OPEN → `The pass is OPEN`; RESTRICTED → `RESTRICTED — Chain Law Level 1` (uses first restriction); CLOSED → headline `Closed — do not attempt` AND (separate element) the frozen legal sentence still present byte-exact; UNKNOWN → `UNKNOWN — check Wyoming 511` with wyoroad.info link. New: standing advisory renders as pill text `Advisory: falling rock (standing)` (lowercased advisory text, literal ` (standing)` suffix) inside the banner. Last-confirmed line format `Last confirmed open 5:48 AM · WYDOT` (time via toLocaleTimeString h:mm AM). KEEP UNMODIFIED: pollerDead gating tests (both), no-reopening-estimate negative test, isStale chip test — they must pass against the new markup without weakening (text-based queries survive restyling; fix querySelectors only if structural).
- [ ] **Step 2:** Restyle: banner = `rounded-[--radius-banner] p-5` filled with the state token (`bg-status-open` etc., white text; unknown uses muted-gray bg per card 1c's UNKNOWN treatment referenced in handoff README), headline `font-display text-[40px] lg:text-[46px] font-extrabold tracking-tight leading-none`, sub-line 13px/90% opacity, advisory pills `bg-white/18 rounded-full px-3 py-1 text-xs inline-block`. DetourBlock = inner card (white/dark-card bg, ink text, radius-card) with same content. `role="status"` aria-live kept.
- [ ] **Step 3 (GREEN):** app suite green (worker/parsers untouched). Build clean.
- [ ] **Step 4:** Commit `"feat(restyle): trailhead status banner + detour block"`.

---

### Task 4: DriveTimes (cards + verbal deltas)

**Files:**
- Modify: `src/app/components/DriveTimes.tsx`, `test/app/DriveTimes.test.tsx`

**Interfaces:**
- Consumes: tokens; card 1a lines 234–252; spec delta mapping (verbatim): `diff = durationSec - typicalSec` in minutes (Math.round(diff/60)); `diffMin <= -5` → `${-diffMin} min faster than usual` (delta-pos); `diffMin >= 5` → `${diffMin} min slower than usual` (delta-neg); else → `about usual` (muted); no delta element when typicalSec null.
- Produces: no API change.

- [ ] **Step 1 (RED):** Replace chip-threshold tests with the verbal mapping, pinning boundaries exactly: diff −300s → `5 min faster than usual`; −299s→`about usual`; +299s→`about usual`; +300s→`5 min slower than usual`; +480s→`8 min slower than usual`; null typical → no `/usual/` text. Section heading `Drive times right now`; flip control text `⇄ Flip direction`; sublabels `Town Square`/`JHMR`/`Airport` per destination. Flip-toggle behavior test kept unmodified.
- [ ] **Step 2:** Implement: route card `bg-card border border-card-border rounded-card px-3.5 py-3 flex justify-between items-center`; left `font-bold text-sm` + sublabel `text-[11.5px] text-muted`; right numeral `font-display text-[22px] font-extrabold` + delta line `text-[11.5px] font-bold` colored per mapping. Flip button `text-accent text-xs font-bold` with aria-pressed kept. All 6 routes render.
- [ ] **Step 3 (GREEN)** all suites; **Step 4:** Commit `"feat(restyle): drive-time cards with verbal deltas"`.

---

### Task 5: AlertsStrip (From the road) + ID-33 slot

**Files:**
- Modify: `src/app/components/AlertsStrip.tsx`, `test/app/AlertsStrip.test.tsx`

**Interfaces:** card 1a lines 253–261; spec §AlertsStrip. Type→emoji map (same as ReportModal's grid): crash 💥, slideoff 🛞, slick ❄, wildlife 🦌, stopped 🚗, closure 🚧, other ⚠.

- [ ] **Step 1 (RED):** Section heading pins `From the road`; item title format `Slick/Ice · westbound to Victor` (type display-name map: crash→Crash, slideoff→Slide-off, slick→Slick/Ice, wildlife→Wildlife, stopped→Stopped traffic, closure→Closure, other→Other; direction wb→`westbound to Victor`, eb→`eastbound to Jackson`, absent→type name alone); note rendered inside quotes `"Glare ice near the summit turnout" · 18 min ago`. FROZEN unmodified: empty-state exact string test, `Unverified community report` label test, id33 advisory presence test (restyle allowed, text pin unchanged).
- [ ] **Step 2:** Implement card layout: 32px icon tile `rounded-[10px]` bg `oklch(0.93 0.04 60)` token (`--color-icon-tile`, add to index.css in this task, light+dark `oklch(0.93 0.04 60)`/`oklch(0.34 0.03 60)`), title 13.5px 700, meta 12px muted, unverified 10.5px faint. ID-33 slot: muted card directly under heading.
- [ ] **Step 3 (GREEN)** all suites; **Step 4:** Commit `"feat(restyle): from-the-road alerts cards"`.

---

### Task 6: Cameras (valley hero + visible timestamps)

**Files:**
- Modify: `src/app/components/Cameras.tsx`, `src/app/cameras.ts` (ordering/caption only if needed — URLs frozen), `test/app/Cameras.test.tsx`

**Interfaces:** card 1a lines 262–271 + 2a right rail; spec §Cameras. Consumes `refreshedAt` prop (existing).

- [ ] **Step 1 (RED):** Order pin: valley renders first (hero, aspect 16/8 full-width), east+west in a 2-col grid below; each tile shows caption AND a visible timestamp text derived from `refreshedAt ?? mount time` formatted `h:mm AM`; attribution string test kept byte-exact (restyle to `font-mono text-[10.5px]` allowed). FROZEN unmodified: onerror→link-card test, beacon-once test, cache-buster-changes test.
- [ ] **Step 2:** Implement: hero `aspect-[16/8] w-full object-cover rounded-card`, halves `aspect-video`; caption row caption-left timestamp-right (timestamp muted 11px); section heading `Cameras`.
- [ ] **Step 3 (GREEN)** all suites; **Step 4:** Commit `"feat(restyle): camera grid with valley hero + visible timestamps"`.

---

### Task 7: WeatherStrip + Sponsor + Footer

**Files:**
- Modify: `src/app/components/WeatherStrip.tsx`, `Sponsor.tsx`, `Footer.tsx`, tests `WeatherStrip.test.tsx`, `Sponsor.test.tsx`, `Footer.test.tsx` (assertion updates only where classes/structure moved — copy pins unchanged)

**Interfaces:** card 1a lines 272–279 (weather tiles + sponsor + footer); spec §WeatherStrip/§Sponsor/§Footer.

- [ ] **Step 1 (RED where changed):** Weather: four tiles labeled `Air` `Road` `Gust` `Visibility` (pin labels; winter surface-prominence test kept). Sponsor: label element `SPONSORED BY TETON FLATS` (new pin, uppercase 10.5px tracking-wide sponsor-label color) + body copy test UNMODIFIED byte-exact + UTM href test unmodified. Footer: link set + `Not affiliated with WYDOT` pins unmodified; restyle to muted small text.
- [ ] **Step 2:** Implement: weather tile = card with value `font-display text-lg font-extrabold` + label `text-[10.5px] text-muted uppercase`; sponsor card `bg-sponsor-bg border-sponsor-border rounded-card p-4`; footer `text-xs text-muted` stacked links.
- [ ] **Step 3 (GREEN)** all suites; **Step 4:** Commit `"feat(restyle): weather tiles, sponsor card, footer"`.

---

### Task 8: ReportModal bottom sheet + Feedback modal

**Files:**
- Modify: `src/app/components/ReportModal.tsx`, `src/app/components/Footer.tsx` (feedback modal lives there — restyle its copy/markup), tests `ReportModal.test.tsx`, `Footer.test.tsx`, `App.test.tsx` (only if trigger markup changed selectors)

**Interfaces:** cards 2d (line 174) and 2e (line 202); spec §ReportModal/§Feedback. Emoji map from Task 5.

- [ ] **Step 1 (RED):** New pins: sheet title `What are you seeing?`; 7 type buttons labeled `💥 Crash`, `🛞 Slide-off`, `❄ Slick/Ice`, `🦌 Wildlife`, `🚗 Stopped traffic`, `🚧 Closure`, `⚠ Other` (Other full-width); direction pills `WB → Victor` / `EB → Jackson`; submit `Send report`; fine-print contains `does not change the official status` (pin substring). Feedback: heading `Tell us what's broken (or what you'd love)`, subline `Goes straight to a human in Teton Valley.`. FROZEN unmodified: honeypot tests (hidden + empty-in-body + 201-parity), maxLength 140, 429 message test, success-closes+refetch tests, feedback POST-contract tests.
- [ ] **Step 2:** Implement: bottom sheet (fixed bottom, rounded-t-2xl, drag-handle bar `h-1 w-9 rounded-full bg-card-border mx-auto`, dimmed backdrop) — desktop: centered dialog max-w-sm is acceptable (mockup is phone; document). Type grid 2-col, selected = `border-2 border-ink`; direction = segmented full-width pills; submit = primary pill button (btn tokens, h-12). Feedback modal same card language.
- [ ] **Step 3 (GREEN)** all suites; **Step 4:** Commit `"feat(restyle): report bottom sheet + feedback modal"`.

---

### Task 9: Visual verification pass + wrap-up

**Files:**
- Create: screenshots under the SDD workspace (NOT committed); Modify: only if drift found (follow-up fixes within scope fence)

- [ ] **Step 1:** `npm run build && npm run db:migrate:local && npx wrangler dev` (background). Seed a representative /api/status by inserting one open snapshot + weather + a travel_time + an alert via `wrangler d1 execute --local` (SQL provided by reading scripts/seed-routes.sql patterns; or run one poll cycle against fixtures is NOT possible — use direct INSERTs with current timestamps).
- [ ] **Step 2:** Playwright (via the available browser tooling or `npx playwright screenshot`): capture 390×844 light, 390×844 dark (emulate prefers-color-scheme), 1280×900 light; plus report-modal-open and feedback-open at 390px. Compare side-by-side against cards 1a/2b/2a/2d/2e (open the dc.html sections). Checklist per screen: page bg, card borders/radii, banner fill+headline size/weight, numeral font, delta colors, section heading sizes, sponsor tint, pill shapes, spacing rhythm (14px gutters / 8px gaps), dark tokens.
- [ ] **Step 3:** Fix any drift found (token or component-level), re-run affected app tests, re-screenshot.
- [ ] **Step 4:** Full gate: all three suites green; `npx tsc --noEmit` clean; build clean; `git diff --stat main -- src/worker src/shared test/parsers test/worker migrations` shows ZERO changes.
- [ ] **Step 5:** Commit `"chore(restyle): visual verification fixes"` (or no-op if clean). Report precache size + screenshot locations.

---

## Self-Review Results

- **Spec coverage:** tokens/fonts/shell→T1; layout/header→T2; banner→T3; drive times→T4; alerts→T5; cameras/timestamps→T6; weather/sponsor/footer→T7; modals→T8; visual pass + scope-fence audit→T9. History/admin/backend explicitly out of scope. ✓
- **Placeholder scan:** none; every copy pin has its exact string; card line numbers verified against the file. ✓
- **Type consistency:** token names defined once in T1 and referenced by exact name in T3–T8; `--color-icon-tile` added in T5 where first used; Header API defined in T2 and unused elsewhere; no component API changes anywhere. ✓
