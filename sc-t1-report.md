# Share-cards T1 (backend) — report

## Status: DONE, no blockers

## Bundle-size checkpoint (critical, per brief)

`npx wrangler deploy --dry-run --outdir /tmp/sc-bundle-final`:

```
Total Upload: 2341.96 KiB / gzip: 823.12 KiB
```

**823 KiB gzip, under the 1 MB free-plan threshold.** No Workers Paid upgrade
needed; not surfacing that step to Drew since it isn't required. Breakdown of
what's in the upload: `index.js` (~848 KB raw, the Worker bundle incl. the
whole app), `@resvg/resvg-wasm`'s wasm (1.37 MB raw, by far the largest single
file), yoga's wasm (88 KB raw), and the three embedded font files (~68 KB
raw total). Gzip compresses the wasm well enough that the total stays under
budget.

## Font/bundling mechanism

- **Renderer:** `workers-og` (npm, bundles satori + `@resvg/resvg-wasm` +
  yoga-wasm for Workers specifically). Its public API only exports
  `ImageResponse`/`loadGoogleFont` — the lower-level `og()` function exists
  internally but isn't exported (confirmed against `dist/index.d.ts`), so
  `src/worker/card/png.ts` uses `ImageResponse`. Its constructor doesn't
  return `this` — it returns a Promise (JS constructors may substitute an
  object for the instance) that resolves to a real `Response` once
  satori/resvg finish; `await new ImageResponse(html, options)` is the
  documented usage.
- **Fonts:** satori needs raw woff/ttf bytes, not woff2 (no woff2
  decompressor). The live UI's `@fontsource-variable/bricolage-grotesque` is
  woff2-only (variable font, no fixed-weight file to hand satori), so
  `@fontsource/bricolage-grotesque` (the static per-weight sibling package)
  was added as a new dependency for weights 700/800 specifically.
  `@fontsource/atkinson-hyperlegible` (already a dependency) ships static
  woff files per weight already, weight 400 used. See
  `src/worker/card/fonts.ts` for the exact files and the full reasoning.
- **Binary import mechanism:** wrangler has no built-in module rule for
  `.woff` (only `.wasm`/`.txt`/`.html`/`.bin` by default). Added to
  `wrangler.toml`:
  ```toml
  [[rules]]
  type = "Data"
  globs = ["**/*.woff"]
  fallthrough = true
  ```
  `fallthrough = true` is required, not cosmetic: defining any custom rule
  turns off wrangler's *default* rules unless fallthrough is set, and
  `workers-og`'s own internal `import ... from "./resvg-*.wasm"` depends on
  the default `.wasm` → CompiledWasm rule still applying. This is the only
  wrangler.toml-level mechanism available (no Vite involvement — this file
  is bundled by wrangler's own esbuild, never Vite, since `main =
  "src/worker/index.ts"` is a separate build from the `dist/` Vite output).
  TypeScript-side: `vite/client` (in `tsconfig.json`'s global `types` array)
  already declares `*.woff` as a string-URL module ahead of anything
  worker-specific could declare, so `src/worker/card/fonts.ts` imports the
  files normally and casts each to `ArrayBuffer` at the import site (one
  line, documented) rather than fighting a duplicate/conflicting ambient
  module declaration.

## Test coverage achieved

Three levels, per the brief's "split the WASM-dependent stage" guidance:

1. **`test/worker/card-render.test.ts`** (10 tests) — pure `buildCardHtml`
   string assertions, zero WASM/Workers-runtime dependency: per-state
   headline copy, byte-exact `CLOSED_LEGAL_COPY`, route rows present/capped
   at 4/omitted, the "as of" footer on every variant, and the
   UNKNOWN-never-shows-drive-times safety invariant.
2. **`test/worker/card-data.test.ts`** (6 tests) — `loadCardData`'s D1
   queries: direction filtering, non-airport exclusion, the ±5min travel-time
   window, per-route closest-reading selection when duplicates exist, and
   the wydotReportTime/capturedAt "as of" preference. Real D1 binding, no
   WASM.
3. **`test/worker/card-route.test.ts`** (11 tests) — full HTTP layer through
   the real `worker.fetch`: **one** integration test does a real
   satori/resvg render and asserts PNG magic bytes + IHDR 1200×630 dimensions
   + `Cache-Control: public, max-age=31536000, immutable`; everything else
   (404s for bad id/dir/missing snapshot, the caches.default reuse-on-repeat
   check, the `/s/{id}` og:image/og:url/og:title rewrite + `?dir=wb`
   handling + canonical-untouched + 302-on-unknown-id + short-cache headers)
   is covered without needing a second real render.

WASM did **not** turn out to be finicky in vitest-pool-workers — it
initialized and rendered cleanly on the first real attempt, no fallback
needed. Full coverage was achievable at all three levels as designed.

Baseline was 385 tests (81/148/156, before this worktree had ever been
built — `dist/` didn't exist yet, so `test:worker` initially showed
ASSETS-dependent failures until `npm run build` ran once). Current: **81 /
176 / 157 = 414 tests, all green.** tsc --noEmit clean.

## A real bug caught via manual `wrangler dev` verification (worth flagging)

The brief asked for a `wrangler dev` sample specifically so a human could
eyeball it, and that caught something the string-level tests couldn't: the
DB's route names contain a literal "→" (U+2192) which **no embedded font
actually has a glyph for** — it rendered as a visible tofu box. Two fix
attempts before landing on one that actually works, all confirmed via
repeated `wrangler dev` sample renders:

1. CSS border-triangle (transparent top/bottom + one solid side) → rendered
   as a solid square, not a triangle.
2. Inline `<svg><path .../></svg>` → rendered as nothing at all —
   `workers-og`'s HTML-string mode parses via `HTMLRewriter` (an HTML, not
   XML, parser), which doesn't reliably support a self-closing `<path/>`.
3. **Landed on:** plain ASCII `>` in place of the arrow (`routeNameHtml` in
   `render.ts`), always present in any Latin-text font.

That investigation also surfaced a second, more important finding: standard
HTML-entity escaping (`&lt;`/`&gt;`/etc, the same pattern `seo-inject.ts` and
`admin.html` each already use) is **wrong** for this specific renderer.
Confirmed empirically: `workers-og`'s pipeline does not entity-decode text
when compositing the image, so an escaped `<b>` rendered as the literal,
garbled text `&lt;b&gt;` rather than either a real element or safe text.
Since `<` is the only character that can structurally open a new element
(confirmed the reverse case too — a raw unescaped `<b>` genuinely did *not*
render bold, proving `sanitizeText`'s strip-only-`<` approach neutralizes it
correctly), `render.ts`'s `sanitizeText` strips only `<` and leaves
`>`/`&`/`"`/`'` completely alone so they display correctly as literal
characters. This is called out prominently in `render.ts`'s comments so
nobody copy-pastes the standard `esc()` pattern into this file later.

## Files

- `src/shared/legal.ts` — hoisted `CLOSED_LEGAL_COPY` (also updated
  `StatusBanner.tsx` and `seo-inject.ts` to import it; both suites'
  byte-identical tests still pass unchanged).
- `src/shared/types.ts` — `ApiStatus.statusSnapshotId: number | null`.
- `src/worker/api/status.ts` — sets it (null when no snapshot or
  `pollerDead`; see the field's own doc comment for why pollerDead forces
  null too).
- `src/worker/card/fonts.ts`, `render.ts`, `data.ts`, `png.ts`, `route.ts` —
  the renderer.
- `src/worker/index.ts` — `/og/` and `/s/` wired in ahead of `/api/`.
- `wrangler.toml` — the `.woff` Data rule.
- `vite.config.ts` + `test/app/pwa-config.test.ts` — SW
  `navigateFallbackDenylist` gets `/^\/s\//`.
- `package.json` — new deps `workers-og`, `@fontsource/bricolage-grotesque`.
- Tests: `test/worker/card-render.test.ts`, `card-data.test.ts`,
  `card-route.test.ts`; fixture updates in `test/app/{App,StatusBanner,
  useStatus}.test.tsx` and `test/worker/api-status.test.ts` for the new
  required `statusSnapshotId` field.
- `share-card-sample.png` (repo root) — real `wrangler dev` render, OPEN
  state with two route rows, saved for Drew.

## Not done (T2's scope, per the task split)

No share button, no frontend wiring, no `App.tsx`/`DriveTimes.tsx` changes.
The `statusSnapshotId` fixture values added to `test/app/*.test.tsx` are the
minimum needed to keep those files compiling against the widened `ApiStatus`
type — no share-button behavior was added there.
