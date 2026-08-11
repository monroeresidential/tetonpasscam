import type { ApiStatus, PassStatus } from '../shared/types';
import { getStatus } from './api/status';
import type { Env } from './env';

type Variant = 'badge' | 'card' | 'strip';

// Bare `/embed` (the picker page, served from ASSETS as embed.html) must NOT
// be swallowed here -- only the three widget endpoints under it are ours.
const EMBED_PATH_RE = /^\/embed\/(badge|card|strip)$/;

function cacheApi(): Cache {
  // Same DOM-vs-Workers-types `caches` cast card/route.ts's handleOgRequest
  // already needs (this project's tsconfig includes both `lib: DOM` and
  // `@cloudflare/workers-types`, and DOM's ambient `caches` global -- with no
  // `.default` -- is the one that wins).
  return (caches as unknown as { default: Cache }).default;
}

// Defense in depth (embed.ts brief's own escaping rule): every interpolated
// value here already comes from our own enums/numbers/formatted times, never
// from user input, but this still routes them through one escaper so a
// future field added to ApiStatus can't slip raw HTML into a page designed
// to be embedded on third-party sites.
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const STATUS_WORD: Record<PassStatus, string> = {
  open: 'OPEN',
  restricted: 'RESTRICTED',
  closed: 'CLOSED',
  unknown: 'UNKNOWN',
};

const STATUS_COLOR: Record<PassStatus, string> = {
  open: 'oklch(0.55 0.13 150)',
  closed: 'oklch(0.5 0.19 27)',
  restricted: 'oklch(0.65 0.13 60)',
  unknown: 'oklch(0.5 0.02 260)',
};

// Inline SVG glyphs for the badge's 44px status circle, white on the status
// color (mock t4a). Path/text drawn directly rather than reused from
// anywhere else in the app -- these four are the only place this project
// draws an open/closed/restricted/unknown glyph outside the /og PNG card.
const STATUS_ICON_SVG: Record<PassStatus, string> = {
  open: '<path d="M5 12.5l4.5 4.5L19 7" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>',
  closed:
    '<path d="M6 6l12 12M18 6L6 18" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>',
  restricted:
    '<text x="12" y="17.5" font-size="16" font-weight="800" fill="#fff" text-anchor="middle" font-family="system-ui,sans-serif">!</text>',
  unknown:
    '<text x="12" y="17.5" font-size="14" font-weight="800" fill="#fff" text-anchor="middle" font-family="system-ui,sans-serif">?</text>',
};

// Only the two eastbound Idaho-side-to-Jackson routes appear in any widget
// (mock t4's badge/card/strip examples all show exactly "Victor" and
// "Driggs" times toward Jackson) -- the other 10 seeded route-directions
// (Teton Village/Airport destinations, westbound) are never surfaced here.
// `full`/`abbrev` are kept as static labels (not read from the `name`
// column) so the card can still show a labeled "—" row for a route with no
// travel_times history yet, when there is no row to read a name from.
const WIDGET_ROUTES: { slug: string; full: string; abbrev: string }[] = [
  { slug: 'victor-jackson-eb', full: 'Victor → Jackson', abbrev: 'Victor→JAC' },
  { slug: 'driggs-jackson-eb', full: 'Driggs → Jackson', abbrev: 'Driggs→JAC' },
];

const DENVER_TIME_FORMAT = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'America/Denver',
});

/** "2:12 PM" -- same Intl options as DriveTimes.tsx's formatAsOf. */
function formatDenverTime(iso: string): string {
  return DENVER_TIME_FORMAT.format(new Date(iso));
}

function findRoute(travelTimes: ApiStatus['travelTimes'], slug: string) {
  return travelTimes.find((t) => t.slug === slug) ?? null;
}

/**
 * Combined drive-times line for badge/strip (`labelKey` picks the
 * abbreviated vs full route label). Rows missing entirely are dropped from
 * the joined line rather than shown as "—" (only the card's separate,
 * always-both-rows layout uses "—" -- see `cardRows` below); the whole line
 * is omitted (`null`) once nothing is left to join. If any included row is
 * `stale`, the first stale row's `capturedAt` suffixes the line -- a single
 * combined line only has room for one "as of", and the freshness rows are
 * flagged individually only so the card's own per-row layout doesn't need
 * this at all (its footer already carries a timestamp).
 */
function buildTimesLine(
  travelTimes: ApiStatus['travelTimes'],
  labelKey: 'full' | 'abbrev',
): string | null {
  const parts: string[] = [];
  let staleAt: string | null = null;
  for (const route of WIDGET_ROUTES) {
    const row = findRoute(travelTimes, route.slug);
    if (!row) continue;
    parts.push(`${route[labelKey]} ${Math.round(row.durationSec / 60)} min`);
    if (row.stale && staleAt === null) staleAt = row.capturedAt;
  }
  if (parts.length === 0) return null;
  const joined = parts.join(' · ');
  return staleAt ? `${joined} · as of ${formatDenverTime(staleAt)}` : joined;
}

function widgetLinkHref(variant: Variant): string {
  return `https://tetonpasscam.com/?utm_source=embed&utm_medium=widget&utm_campaign=${variant}`;
}

const FONT_FACE_CSS = `
@font-face {
  font-family: 'Bricolage Grotesque';
  src: url('/fonts/bricolage-latin-wght.woff2') format('woff2-variations');
  font-weight: 200 800;
  font-display: swap;
}
@font-face {
  font-family: 'Atkinson Hyperlegible';
  src: url('/fonts/atkinson-latin-400.woff2') format('woff2');
  font-weight: 400;
  font-display: swap;
}
@font-face {
  font-family: 'Atkinson Hyperlegible';
  src: url('/fonts/atkinson-latin-700.woff2') format('woff2');
  font-weight: 700;
  font-display: swap;
}`;

/** Wraps a variant's markup + CSS into a complete, self-contained document.
 *  Font `src` urls are root-relative (`/fonts/...`), which resolves against
 *  OUR origin even inside a third-party page's iframe -- the whole point of
 *  self-hosting rather than depending on the parent page's fonts. */
function renderDocument(variantCss: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Teton Pass status</title>
<style>
${FONT_FACE_CSS}
* { box-sizing: border-box; }
body { margin: 0; font-family: 'Atkinson Hyperlegible', system-ui, sans-serif; }
a.widget-link { display: block; text-decoration: none; color: inherit; }
${variantCss}
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

function badgeHeadline(status: PassStatus): string {
  return status === 'unknown' ? 'Teton Pass status UNKNOWN' : `Teton Pass is ${STATUS_WORD[status]}`;
}

/** Badge's line 2: drive times for open/restricted (dropped if neither route
 *  has data), the closed detour notice (hard rule 5 -- "do not attempt",
 *  never an invented reopening estimate), or the unknown disclaimer (hard
 *  rule 1 -- never implies currency by showing stale-looking times). */
function badgeLine2(apiStatus: ApiStatus): string | null {
  if (apiStatus.status === 'closed') return 'Do not attempt · detour via Swan Valley';
  if (apiStatus.status === 'unknown') return 'Check Wyoming 511 before traveling';
  return buildTimesLine(apiStatus.travelTimes, 'abbrev');
}

function renderBadge(apiStatus: ApiStatus): string {
  const color = STATUS_COLOR[apiStatus.status];
  const line2 = badgeLine2(apiStatus);
  const css = `
.badge { width: 320px; height: 88px; background: #211d17; border: 1px solid #3a342b; border-radius: 14px; padding: 14px 16px; display: flex; align-items: center; gap: 12px; }
.badge-icon { width: 44px; height: 44px; border-radius: 50%; flex: none; display: flex; align-items: center; justify-content: center; background: ${color}; }
.badge-text { flex: 1; min-width: 0; overflow: hidden; }
.badge-line1 { font-family: 'Bricolage Grotesque'; font-weight: 800; font-size: 17px; color: #f0ebe1; line-height: 1.15; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.badge-line2 { font-family: 'Atkinson Hyperlegible'; font-weight: 400; font-size: 11.5px; color: #a39880; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.badge-line3 { font-family: 'Atkinson Hyperlegible'; font-weight: 700; font-size: 10.5px; color: oklch(0.75 0.11 60); margin-top: 4px; }`;
  const body = `<a class="widget-link" href="${esc(widgetLinkHref('badge'))}" target="_blank" rel="noopener">
  <div class="badge">
    <div class="badge-icon"><svg width="24" height="24" viewBox="0 0 24 24">${STATUS_ICON_SVG[apiStatus.status]}</svg></div>
    <div class="badge-text">
      <div class="badge-line1">${esc(badgeHeadline(apiStatus.status))}</div>
      ${line2 ? `<div class="badge-line2">${esc(line2)}</div>` : ''}
      <div class="badge-line3">tetonpasscam.com</div>
    </div>
  </div>
</a>`;
  return renderDocument(css, body);
}

function cardHeadline(status: PassStatus): string {
  return status === 'unknown' ? 'The pass status UNKNOWN' : `The pass is ${STATUS_WORD[status]}`;
}

/** Card footer's "as of" reads the fresher of the two route rows if either
 *  has data, else falls back to the response's own `generatedAt` -- same
 *  fallback the brief specifies, so the footer always shows a timestamp even
 *  when there's no travel-time history yet. */
function cardFooterAsOf(apiStatus: ApiStatus): string {
  const rows = WIDGET_ROUTES.map((r) => findRoute(apiStatus.travelTimes, r.slug)).filter(
    (r): r is NonNullable<typeof r> => r !== null,
  );
  const capturedAt =
    rows.length > 0
      ? rows.reduce((latest, r) => (Date.parse(r.capturedAt) > Date.parse(latest) ? r.capturedAt : latest), rows[0].capturedAt)
      : apiStatus.generatedAt;
  return `${formatDenverTime(capturedAt)} MT`;
}

/** Card's middle section: the closed variant replaces both route rows with a
 *  single centered detour notice (hard rule 5); unknown forces both rows to
 *  "—" rather than reading real `durationSec` values (hard rule 1 -- never
 *  imply currency for an unresolved status); open/restricted show each
 *  route's minutes or "—" if that route has no data yet. */
function cardBodyHtml(apiStatus: ApiStatus): string {
  if (apiStatus.status === 'closed') {
    return `<div class="card-body"><div class="card-closed">
      <div class="card-closed-line1">Closed — do not attempt</div>
      <div class="card-closed-line2">Detour: Swan Valley via US-26/89</div>
    </div></div>`;
  }
  const showTimes = apiStatus.status === 'open' || apiStatus.status === 'restricted';
  const rowsHtml = WIDGET_ROUTES.map((route) => {
    const row = showTimes ? findRoute(apiStatus.travelTimes, route.slug) : null;
    const value = row ? `${Math.round(row.durationSec / 60)} min` : '—';
    return `<div class="card-row"><div class="card-row-label">${esc(route.full)}</div><div class="card-row-value">${esc(value)}</div></div>`;
  }).join('');
  return `<div class="card-body">${rowsHtml}</div>`;
}

function renderCard(apiStatus: ApiStatus): string {
  const color = STATUS_COLOR[apiStatus.status];
  const css = `
.card { width: 300px; height: 250px; background: #211d17; border: 1px solid #3a342b; border-radius: 16px; overflow: hidden; display: flex; flex-direction: column; }
.card-header { background: ${color}; padding: 14px 16px; flex: none; }
.card-eyebrow { font-family: 'Atkinson Hyperlegible'; font-weight: 700; font-size: 10px; letter-spacing: .06em; color: rgba(255,255,255,.75); }
.card-headline { font-family: 'Bricolage Grotesque'; font-weight: 800; font-size: 26px; color: #fff; margin-top: 4px; line-height: 1.1; }
.card-body { flex: 1; display: flex; flex-direction: column; justify-content: center; padding: 0 16px; min-height: 0; overflow: hidden; }
.card-row { display: flex; align-items: center; justify-content: space-between; padding: 10px 0; }
.card-row + .card-row { border-top: 1px solid #3a342b; }
.card-row-label { font-family: 'Atkinson Hyperlegible'; font-weight: 700; font-size: 14px; color: #f0ebe1; }
.card-row-value { font-family: 'Bricolage Grotesque'; font-weight: 800; font-size: 18px; color: #f0ebe1; }
.card-closed { text-align: center; width: 100%; }
.card-closed-line1 { font-family: 'Atkinson Hyperlegible'; font-weight: 700; font-size: 14px; color: #a39880; }
.card-closed-line2 { font-family: 'Atkinson Hyperlegible'; font-weight: 400; font-size: 12.5px; color: #a39880; margin-top: 4px; }
.card-footer { background: #2b2620; padding: 10px 16px; flex: none; display: flex; align-items: center; justify-content: space-between; }
.card-footer-left { font-family: 'Atkinson Hyperlegible'; font-weight: 400; font-size: 11px; color: #a39880; }
.card-footer-right { font-family: 'Atkinson Hyperlegible'; font-weight: 700; font-size: 11.5px; color: oklch(0.75 0.11 60); }`;
  const body = `<a class="widget-link" href="${esc(widgetLinkHref('card'))}" target="_blank" rel="noopener">
  <div class="card">
    <div class="card-header">
      <div class="card-eyebrow">TETON PASS · HWY 22</div>
      <div class="card-headline">${esc(cardHeadline(apiStatus.status))}</div>
    </div>
    ${cardBodyHtml(apiStatus)}
    <div class="card-footer">
      <div class="card-footer-left">as of ${esc(cardFooterAsOf(apiStatus))}</div>
      <div class="card-footer-right">tetonpasscam.com →</div>
    </div>
  </div>
</a>`;
  return renderDocument(css, body);
}

/** Strip's right-aligned times/status span -- same status-dependent copy as
 *  `badgeLine2` (closed detour notice, unknown disclaimer, or the joined
 *  drive-times line), just with full route labels instead of abbreviated
 *  ones (strip has the horizontal room; badge doesn't). */
function stripTimesText(apiStatus: ApiStatus): string {
  if (apiStatus.status === 'closed') return 'Do not attempt · detour via Swan Valley';
  if (apiStatus.status === 'unknown') return 'Check Wyoming 511 before traveling';
  return buildTimesLine(apiStatus.travelTimes, 'full') ?? '';
}

function renderStrip(apiStatus: ApiStatus): string {
  const color = STATUS_COLOR[apiStatus.status];
  const timesText = stripTimesText(apiStatus);
  const css = `
.strip { width: 100%; height: 64px; background: #211d17; border: 1px solid #3a342b; border-radius: 12px; padding: 12px 18px; display: flex; align-items: center; gap: 14px; }
.strip-pill { flex: none; background: ${color}; color: #fff; font-family: 'Bricolage Grotesque'; font-weight: 800; font-size: 13px; border-radius: 999px; padding: 4px 10px; }
.strip-title { flex: none; font-family: 'Bricolage Grotesque'; font-weight: 700; font-size: 14px; color: #f0ebe1; }
.strip-times { flex: 1; min-width: 0; text-align: right; font-family: 'Atkinson Hyperlegible'; font-size: 12px; color: #a39880; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.strip-cta { flex: none; margin-left: auto; font-family: 'Atkinson Hyperlegible'; font-weight: 700; font-size: 12px; color: oklch(0.75 0.11 60); }
/* Under ~560px the drive-times span never gets enough room to avoid
   wrapping onto a second line -- hiding it (rather than shrinking the font
   further) keeps the strip at its fixed 64px height at every width. */
@media (max-width: 560px) {
  .strip-times { display: none; }
}`;
  const body = `<a class="widget-link" href="${esc(widgetLinkHref('strip'))}" target="_blank" rel="noopener">
  <div class="strip">
    <div class="strip-pill">● ${esc(STATUS_WORD[apiStatus.status])}</div>
    <div class="strip-title">Teton Pass</div>
    ${timesText ? `<div class="strip-times">${esc(timesText)}</div>` : ''}
    <div class="strip-cta">tetonpasscam.com →</div>
  </div>
</a>`;
  return renderDocument(css, body);
}

function renderWidget(variant: Variant, apiStatus: ApiStatus): string {
  if (variant === 'badge') return renderBadge(apiStatus);
  if (variant === 'card') return renderCard(apiStatus);
  return renderStrip(apiStatus);
}

/**
 * `GET /embed/{badge|card|strip}` -- self-contained HTML widgets meant to be
 * `<iframe>`d on third-party sites (see `/embed`, the picker page serving
 * copy-paste snippets). Returns `null` for anything outside `/embed/` or
 * non-GET so index.ts falls through to ASSETS for those -- in particular
 * bare `/embed` (the picker page itself) and `/embed/bogus` both need to
 * reach that fallthrough/404 path untouched by this handler.
 *
 * Deliberately NOT immutable like `/og`'s cache-control: these render live
 * status that changes every poll cycle, so the 5-minute TTL here matches the
 * picker page's "Auto-updates every 5 minutes" copy. No X-Frame-Options or
 * frame-ancestors CSP is ever set -- the entire point of this endpoint is to
 * be embedded in a frame on someone else's origin.
 */
export async function handleEmbedRequest(req: Request, env: Env): Promise<Response | null> {
  const url = new URL(req.url);
  if (!url.pathname.startsWith('/embed/') || req.method !== 'GET') return null;

  const cache = cacheApi();
  const cached = await cache.match(req);
  if (cached) return cached;

  const match = url.pathname.match(EMBED_PATH_RE);
  if (!match) {
    return new Response('Not found', { status: 404 });
  }
  const variant = match[1] as Variant;

  try {
    const apiStatus = await getStatus(env);
    const html = renderWidget(variant, apiStatus);
    const response = new Response(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=300, s-maxage=300',
      },
    });
    await cache.put(req, response.clone());
    return response;
  } catch (err) {
    console.error('renderWidget failed', err);
    return new Response('Not found', { status: 404 });
  }
}
