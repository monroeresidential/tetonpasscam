import { desc, eq } from 'drizzle-orm';

import { DEAD_HOURS, TRAVEL_TIME_FRESHNESS_MIN } from './api/status';
import { db, routes, statusSnapshots, travelTimes, weatherSnapshots } from './db';
import type { Env } from './env';

// Same link StatusBanner.tsx's UNKNOWN state points to -- one canonical
// "go check the official source" URL for both the client UI and this
// edge-rendered fallback.
const WYOROAD_URL = 'https://www.wyoroad.info/highway/conditions/RoadClosures.html';
// Byte-identical to StatusBanner.tsx's CLOSED_LEGAL_COPY (hard rule #5:
// CLOSED must say "do not attempt", never "not recommended", and the
// statutory fine belongs alongside it).
const CLOSED_LEGAL_COPY =
  'Closed — do not attempt. Traveling a closed Wyoming road is illegal (up to $750 fine).';
const VICTOR_JACKSON_EB_SLUG = 'victor-jackson-eb';

const STATUS_LABEL: Record<'open' | 'restricted' | 'closed', string> = {
  open: 'open',
  restricted: 'restricted',
  closed: 'closed',
};

const TIME_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Denver',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});
const DATE_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Denver',
  month: 'short',
  day: 'numeric',
});

/** "2:45 PM MT, Aug 10" -- America/Denver wall-clock, "MT" spelled out
 *  literally rather than via Intl's `timeZoneName` (which would print the
 *  DST-dependent "MST"/"MDT" and read oddly to a casual reader). */
function formatDenverTimestamp(iso: string): string {
  const d = new Date(iso);
  return `${TIME_FMT.format(d)} MT, ${DATE_FMT.format(d)}`;
}

/** Escapes the five HTML-significant characters. `conditionText` originates
 *  from WYDOT's own HTML (parsed, not authored by us) and is re-embedded
 *  here verbatim otherwise -- never trust it unescaped (see the XSS
 *  regression test in test/worker/seo-inject.test.ts). */
function esc(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Builds the inner HTML of the `<div data-live-status>` block: one flowing
 * paragraph reporting the newest known status/weather/travel-time reading,
 * or an "unavailable" fallback. Mirrors `getStatus`'s (src/worker/api/
 * status.ts) safety semantics on the status word specifically -- a snapshot
 * older than `DEAD_HOURS`, or one whose own status is already 'unknown'
 * (unresolved WYDOT-vs-fallback disagreement), must never render a status
 * word as current. Weather/travel-time are supplementary and are only
 * appended when a fresh-enough reading exists.
 */
async function buildLiveStatusHtml(env: Env, nowMs: number): Promise<string> {
  const database = db(env);

  const [newest] = await database
    .select()
    .from(statusSnapshots)
    .orderBy(desc(statusSnapshots.id))
    .limit(1);

  let sentence: string | null = null;
  if (newest) {
    const ageMs = nowMs - Date.parse(newest.capturedAt);
    const pollerDead = !Number.isFinite(ageMs) || ageMs > DEAD_HOURS * 3_600_000;
    const status: 'open' | 'restricted' | 'closed' | 'unknown' = pollerDead
      ? 'unknown'
      : (newest.status as 'open' | 'restricted' | 'closed' | 'unknown');

    if (status !== 'unknown') {
      const timestamp = formatDenverTimestamp(newest.capturedAt);
      let s = `Latest reported status (as of ${timestamp}): Teton Pass is ${STATUS_LABEL[status]}`;
      if (newest.conditionText) {
        s += ` — "${esc(newest.conditionText)}"`;
      }
      s += '.';
      if (status === 'closed') {
        s += ` ${CLOSED_LEGAL_COPY}`;
      }
      sentence = s;
    }
  }

  if (!sentence) {
    sentence = `Current status is temporarily unavailable — check <a href="${WYOROAD_URL}">Wyoming 511</a>.`;
  }

  const [weatherRow] = await database
    .select()
    .from(weatherSnapshots)
    .orderBy(desc(weatherSnapshots.id))
    .limit(1);
  if (weatherRow && weatherRow.airF != null) {
    sentence += ` Summit air temperature ${Math.round(weatherRow.airF)}°F.`;
  }

  const [travelRow] = await database
    .select({ durationSec: travelTimes.durationSec, capturedAt: travelTimes.capturedAt })
    .from(travelTimes)
    .innerJoin(routes, eq(routes.id, travelTimes.routeId))
    .where(eq(routes.slug, VICTOR_JACKSON_EB_SLUG))
    .orderBy(desc(travelTimes.capturedAt))
    .limit(1);
  if (travelRow) {
    const ageMs = nowMs - Date.parse(travelRow.capturedAt);
    // Same "no valid placeholder" contract as getStatus's travelTimes filter
    // -- a drive time older than the freshness window is omitted entirely
    // rather than shown as if it were live.
    if (Number.isFinite(ageMs) && ageMs <= TRAVEL_TIME_FRESHNESS_MIN * 60_000) {
      const minutes = Math.round(travelRow.durationSec / 60);
      sentence += ` Victor to Jackson is currently running about ${minutes} minutes.`;
    }
  }

  return `<div data-live-status><p>${sentence}</p></div>`;
}

/**
 * Edge-injects a live-status paragraph into the homepage's static
 * `#seo-shell` so crawlers/no-JS agents see current conditions instead of
 * only the static explainer text (SEO audit fix #2). Identical HTML for
 * every requester -- no User-Agent sniffing (that would be cloaking) --
 * React hydration is unaffected: `#seo-shell` is a sibling of `#root` that
 * the app hides once it mounts (see index.html's own comment on the two).
 *
 * Failure isolation: ANY error here (D1 unreachable, HTMLRewriter throwing,
 * a malformed row) falls back to the original, untransformed `response`.
 * This feature must never be the reason the homepage 500s.
 */
export async function injectLiveStatus(response: Response, env: Env): Promise<Response> {
  try {
    const html = await buildLiveStatusHtml(env, Date.now());
    return new HTMLRewriter()
      .on('#seo-shell', {
        element(el) {
          el.append(html, { html: true });
        },
      })
      .transform(response);
  } catch (err) {
    console.error('injectLiveStatus failed; serving untransformed homepage', err);
    return response;
  }
}
