# Shareable live-status OG cards — Design

Date: 2026-08-10. Drew-approved decisions: banner-dominant card layout; Jackson-bound 4 routes (direction follows the sharer's flip state); Workers Paid upgrade pre-authorized IF the renderer exceeds the free plan's 1MB compressed script limit (flag before invoking).

## Goal
A share button that produces a unique URL whose social preview image shows OPEN/CLOSED and current drive times legibly — status readable from the image alone, click-through lands on the live site. Cards are snapshots: a share permanently shows what the sharer saw, with the "as of" time baked in (stale-share honesty). Branding of the card template comes later — keep it a self-contained template module.

## Architecture

**Share URL:** `tetonpasscam.com/s/{snapshotId}` (+ `?dir=wb` when the sharer had the flip toggled; default eb). `snapshotId` = `status_snapshots.id` of the snapshot the sharer was viewing — additive `statusSnapshotId: number | null` field on ApiStatus (exposed by GET /api/status from the newest-snapshot row it already reads).

**`GET /og/{id}-{dir}.png`** (worker route, dir ∈ eb|wb): loads that snapshot + its cycle's travel_times (rows within ±5 min of the snapshot's captured_at, filtered to the 4 non-airport routes in {dir}) + renders a 1200×630 PNG:
- Cream page background (#faf7f0), ink text (#2b2620) — light-mode card always (feeds are white/light contexts; dark variant is future branding).
- Top banner block in the status color (tokens: open oklch(0.55 0.13 150) → rendered as its hex equivalent for the renderer, restricted amber, closed red, unknown gray): "The pass is OPEN" (Bricolage 800, huge) — same state phrasings as StatusBanner incl. `RESTRICTED — {restriction}`.
- CLOSED cards: the byte-exact legal sentence under the headline (import CLOSED_LEGAL_COPY — HOIST it to src/shared/ so StatusBanner + seo-inject + card share one constant; closes a ledgered minor).
- UNKNOWN cards: "check Wyoming 511" line, NO drive times shown (an unknown-status share must not imply passability).
- Route rows (≤4): "Victor → Jackson   38 min" large; rows missing from that cycle are omitted; zero rows → omit section.
- Footer: `as of {h:mm A} MT · {Mon D} · tetonpasscam.com` (America/Denver; reuse tz helpers).
- Renderer: satori + @resvg/resvg-wasm (workers-og if it fits cleanly), fonts embedded as subset TTF/WOFF buffers (Bricolage 700/800 + Atkinson 400). BUNDLE CHECKPOINT after wiring: report gzip size; >1MB → stop, surface the paid-upgrade step to Drew before deploy.
- Validation: non-numeric/unknown id → 404. Errors → 404 (no 500s; card endpoints are best-effort).
- Caching: `Cache-Control: public, max-age=31536000, immutable` + caches.default — snapshot data never changes.

**`GET /s/{id}`** — serves the app HTML (ASSETS index) transformed via the existing HTMLRewriter pattern: replaces og:image/twitter:image with the absolute /og/{id}-{dir}.png, og:url with the share URL, og:title with a status-bearing title ("Teton Pass is OPEN — live conditions"), canonical stays https://tetonpasscam.com/ (shares are duplicates of the homepage for SEO purposes). Humans get the normal live app (React ignores the path; no client routing). Unknown id → redirect 302 to /. Cache: same s-maxage=300/must-revalidate pattern as the homepage. NOTE: the SW navigateFallback must NOT swallow /s/* for installed-PWA users → add `/^\/s\//` to navigateFallbackDenylist.

**Share button (frontend):** in the DriveTimes section header next to Flip: "Share" (icon + text, accent styling). onClick: builds `/s/{data.statusSnapshotId}${direction==='wb'?'?dir=wb':''}`; navigator.share({title, url}) when available, else clipboard.writeText + existing toast pattern ("Link copied"). Disabled/hidden when statusSnapshotId is null (pollerDead/no data — don't share nothing).

## Task split
- T1 (backend): shared CLOSED_LEGAL_COPY hoist; ApiStatus.statusSnapshotId; card renderer module + /og route + /s route + SW denylist entry; worker tests (PNG magic bytes + dimensions, per-state content via SVG-stage inspection where feasible, 404s, immutable headers, /s OG-tag rewrite, unknown-id redirect); bundle-size report; wrangler dev visual sample saved for Drew.
- T2 (frontend): share button + hook wiring + app tests (share URL construction incl. dir, navigator.share fallback to clipboard, hidden-when-null); byte-parity where copy repeats.

## Out of scope (future branding pass)
Dark-mode card variant, Teton Flats co-branding on cards, per-camera share cards, /s/* in sitemap (excluded — they're ephemeral duplicates).
