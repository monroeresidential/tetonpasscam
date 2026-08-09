import { and, desc, eq, isNull, ne, or } from 'drizzle-orm';

import type { Env } from '../env';
import {
  db,
  detourSnapshots,
  id33Events,
  routes,
  statusSnapshots,
  travelTimes,
  weatherSnapshots,
} from '../db';
import { fetchId33Events } from './idaho511';
import { fetchRouteTime, inPollingWindow } from './google-routes';
import {
  diffAdvisories,
  parseRoadClosures,
  parseRoutesResults,
  parseStatewide,
  type StatusResult,
} from './wydot-status';
import { parseSensorPage } from './wydot-weather';

// wyoroad.info endpoints. Substring-stable (fakeFetch in tests matches on
// substrings like 'RoadClosures.html' / 'Sensors.StationResults'), so the
// exact query string here doesn't matter for test matching, only for the
// real live fetch.
const ROAD_CLOSURES_URL = 'https://www.wyoroad.info/highway/conditions/RoadClosures.html';
const ROUTESRESULTS_WY22_URL = 'https://www.wyoroad.info/pls/Browse/WRR.RoutesResults?SelectedRoute=WY22';
const STATEWIDE_URL = 'https://www.wyoroad.info/pls/Browse/MEDIA.Statewide';
const SENSORS_URL = 'https://www.wyoroad.info/pls/Browse/Sensors.StationResults?SelectedStation=Teton+Pass';
const ROUTESRESULTS_US26_URL = 'https://www.wyoroad.info/pls/Browse/WRR.RoutesResults?SelectedRoute=US26';
const ROUTESRESULTS_US89_URL = 'https://www.wyoroad.info/pls/Browse/WRR.RoutesResults?SelectedRoute=US89';

const WYDOT_USER_AGENT = 'tetonpasscam.com poller (drew@monroeresidential.com)';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch a wyoroad.info URL with the required User-Agent, a 30s abort
 * timeout, and one retry (after a ~2s backoff) on a 5xx response or a thrown
 * error (network failure / abort). Returns the response body text on
 * success, or null on any failure after the retry is exhausted -- callers
 * treat null exactly like a thrown parse failure (i.e. it feeds into the
 * 'unknown' path, never 'open'). Used for every wyoroad.info fetch in this
 * module (status primary/fallback/crosscheck, weather, detours) so the
 * retry/backoff/UA behavior is applied uniformly.
 */
async function wydotFetch(url: string, fetcher: typeof fetch): Promise<string | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetcher(url, {
        headers: { 'User-Agent': WYDOT_USER_AGENT },
        signal: AbortSignal.timeout(30_000),
      });
      if (response.ok) return await response.text();
      if (response.status >= 500 && attempt === 0) {
        await sleep(2000);
        continue;
      }
      return null;
    } catch {
      if (attempt === 0) {
        await sleep(2000);
        continue;
      }
      return null;
    }
  }
  return null;
}

function unknownStatusResult(source: StatusResult['source']): StatusResult {
  return {
    status: 'unknown',
    conditionText: null,
    advisories: [],
    restrictions: [],
    wydotReportTime: null,
    source,
  };
}

/**
 * Resolve the current Teton Pass status via the primary -> fallback ->
 * crosscheck chain:
 *
 *   1. Try the primary source (RoadClosures.html). If it resolves to a
 *      definite status (open/restricted/closed), use it (source 'primary').
 *   2. Only when primary is 'unknown' (fetch failed/threw, or the page
 *      shape was unrecognized/ambiguous) do we spend a second fetch on the
 *      fallback source (RoutesResults?SelectedRoute=WY22). If IT resolves,
 *      use it (source 'fallback').
 *   3. If BOTH primary and fallback failed to produce anything but
 *      'unknown', neither offers a trustworthy opinion to agree or disagree
 *      with -- so as a last resort we consult the Statewide cross-check
 *      page. Statewide only ever signals 'closed' or 'restricted' (per its
 *      own parser, it never reports 'open'), so trusting it here can't
 *      introduce a false "open". If it resolves, use it (source
 *      'crosscheck'); otherwise the cycle is genuinely unresolved and we
 *      report 'unknown'.
 *
 * NOTE on interpretation: the brief's wording ("if primary and fallback
 * disagree on open-vs-closed, consult Statewide") literally requires two
 * concrete opinions to compare -- but by construction fallback is only ever
 * fetched when primary is 'unknown', so primary never carries an actual
 * open/closed opinion to disagree with at that point (and wydot-status.ts,
 * which this task must not modify, doesn't expose any partial signal for an
 * 'unknown' result to compare against). This implementation treats "both
 * sources failed to agree on ANY resolved status" as the trigger for the
 * Statewide consult, which is the closest safe, testable, non-invasive
 * reading: it never weakens the "never open without real evidence"
 * invariant, and it makes every clause in the brief ("still unresolved ->
 * unknown") reachable.
 */
export async function resolveStatus(fetcher: typeof fetch): Promise<StatusResult> {
  let primary: StatusResult;
  try {
    const html = await wydotFetch(ROAD_CLOSURES_URL, fetcher);
    primary = html === null ? unknownStatusResult('primary') : parseRoadClosures(html);
  } catch {
    primary = unknownStatusResult('primary');
  }
  if (primary.status !== 'unknown') return primary;

  let fallback: StatusResult;
  try {
    const html = await wydotFetch(ROUTESRESULTS_WY22_URL, fetcher);
    fallback = html === null ? unknownStatusResult('fallback') : parseRoutesResults(html);
  } catch {
    fallback = unknownStatusResult('fallback');
  }
  if (fallback.status !== 'unknown') return fallback;

  try {
    const html = await wydotFetch(STATEWIDE_URL, fetcher);
    const statewideStatus = html === null ? 'unknown' : parseStatewide(html);
    // Allowlist, not a not-unknown check: this is the one place that decides
    // whether the crosscheck source gets to set the banner, so it must
    // itself enforce "never open without fresh primary/fallback evidence"
    // rather than trusting parseStatewide's current behavior (which today
    // never emits 'open', but that invariant belongs here too, not only in
    // a module this task isn't allowed to touch).
    if (statewideStatus === 'closed' || statewideStatus === 'restricted') {
      return { ...unknownStatusResult('crosscheck'), status: statewideStatus };
    }
  } catch {
    // fall through to unknown below
  }

  return unknownStatusResult('primary');
}

function stripDetourHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

interface DetourSegment {
  location: string;
  condition: string;
  isClosed: boolean;
}

/** Extract every segment row (`closurelocation` + "*cond" cell pair) from a
 *  RoutesResults page for a detour route (US26/US89). A single-route
 *  RoutesResults page can list multiple segments statewide for that route
 *  number (mirroring the two-row WY22 fixture from Task 4), so unlike
 *  `parseRoadClosures`/`parseRoutesResults` (which locate ONE specific,
 *  known segment by its fixed `SEGMENT_TEXT`), there's no single segment
 *  name to anchor on here -- these are arbitrary detour routes, so every
 *  segment row is collected and the caller decides which one(s) matter.
 *  Never throws; an unrecognized/empty page yields an empty list. */
function extractDetourSegments(html: string): DetourSegment[] {
  try {
    const segments: DetourSegment[] = [];
    for (const rowBlock of html.split(/<tr[\s>]/i)) {
      const locationMatch = /<td\s+class="closurelocation"[^>]*>([\s\S]*?)<\/td>/i.exec(rowBlock);
      const condMatch = /<td\s+class="([a-zA-Z]*cond)"[^>]*>([\s\S]*?)<\/td>/i.exec(rowBlock);
      if (!locationMatch || !condMatch) continue;
      const location = stripDetourHtml(locationMatch[1]);
      const condition = stripDetourHtml(condMatch[2]);
      if (!location || !condition) continue;
      segments.push({ location, condition, isClosed: condMatch[1].toLowerCase() === 'closedcond' });
    }
    return segments;
  } catch {
    return [];
  }
}

const MAX_JOINED_DETOUR_SEGMENTS = 3;

/** Summarize a detour route's current condition as a single self-describing
 *  string ("Location: condition"). When any segment is closed (`closedcond`
 *  class), that segment alone is reported -- it's the one most relevant to
 *  a driver deciding whether this detour is viable, regardless of where it
 *  falls in page order. Otherwise (no closure), the first few segments are
 *  joined so the summary isn't silently dropping segments a driver might
 *  need, without unbounded growth on a route with many reported segments.
 *  Returns null (never a fabricated placeholder) when the page has no
 *  recognizable segment rows at all. */
function summarizeDetourConditions(html: string): string | null {
  const segments = extractDetourSegments(html);
  if (segments.length === 0) return null;
  const closed = segments.find((s) => s.isClosed);
  if (closed) return `${closed.location}: ${closed.condition}`;
  return segments
    .slice(0, MAX_JOINED_DETOUR_SEGMENTS)
    .map((s) => `${s.location}: ${s.condition}`)
    .join('; ');
}

const DETOUR_ROUTES: Array<{ route: 'US26' | 'US89'; url: string }> = [
  { route: 'US26', url: ROUTESRESULTS_US26_URL },
  { route: 'US89', url: ROUTESRESULTS_US89_URL },
];

/** Fetch the current condition text for the two detour routes (US26, US89)
 *  offered when Teton Pass (WY22) is closed. Only called when the resolved
 *  status is 'closed'. Never throws: a failed/unrecognized fetch for a
 *  route simply omits that route from the result, rather than fabricating
 *  a placeholder entry. */
export async function fetchDetours(
  fetcher: typeof fetch,
): Promise<{ route: 'US26' | 'US89'; conditionText: string }[]> {
  const out: { route: 'US26' | 'US89'; conditionText: string }[] = [];
  for (const { route, url } of DETOUR_ROUTES) {
    try {
      const html = await wydotFetch(url, fetcher);
      if (html === null) continue;
      const conditionText = summarizeDetourConditions(html);
      if (conditionText === null) continue;
      out.push({ route, conditionText });
    } catch {
      // skip this route; never let one detour fetch failure affect the other
    }
  }
  return out;
}

/**
 * Run one poll cycle: resolve status, diff advisories against the previous
 * snapshot (log only -- push notifications are P2), capture weather,
 * capture travel times for all 12 route-directions (only inside the
 * polling window), upsert Idaho 511 ID-33 events, and (only when the
 * resolved status is 'closed') fetch detour conditions. Every step runs in
 * its own try/catch so one source's failure can never block another's, and
 * a status_snapshots row is written every single cycle -- even 'unknown' --
 * because the kill-switch depends on that row existing.
 *
 * `nowMs` is an optional third parameter (not part of the Task 8 brief's
 * declared 2-arg `runPollCycle(env, fetcher?)` signature, but added here on
 * top of it) so tests can pin "now" for the polling-window check without
 * fighting vitest-pool-workers' real Workers runtime with fake timers --
 * the brief for this task explicitly calls for this via "reads a clock
 * param". It defaults to `Date.now()`, so every existing call site
 * (including the real `scheduled` dispatcher) is unaffected.
 */
export async function runPollCycle(
  env: Env,
  fetcher: typeof fetch = fetch,
  nowMs: number = Date.now(),
): Promise<void> {
  const database = db(env);
  const capturedAt = new Date(nowMs).toISOString();

  // Step 1: status (must always end in a StatusResult, even if resolveStatus
  // itself somehow throws -- the outer try/catch below still guarantees a
  // status_snapshots row gets written).
  let status: StatusResult;
  try {
    status = await resolveStatus(fetcher);
  } catch (err) {
    console.error('[poller] resolveStatus threw', err);
    status = unknownStatusResult('primary');
  }

  // Step 2: advisory diff vs the previous RELIABLE snapshot (log only for
  // now; P2 wires this into push notifications). `status.advisories` is
  // only ever real, parsed data when the cycle resolved via 'primary' or
  // 'fallback' -- an 'unknown' cycle's advisories are always `[]`
  // (unknownStatusResult), and a 'crosscheck' cycle's advisories are also
  // always `[]` (parseStatewide only reports a PassStatus, never
  // advisories). Diffing either of those against a real previous list would
  // manufacture a spurious "all standing advisories removed" event on the
  // unknown/crosscheck cycle itself, followed by a spurious "re-added" event
  // on the next good read -- so this step is skipped entirely unless the
  // CURRENT cycle has real advisory data, and it's diffed against the most
  // recent PRIOR snapshot that itself had real advisory data (status !=
  // 'unknown' and source in primary/fallback), skipping over any
  // intervening unknown/crosscheck rows, so a blip between two good reads
  // never itself looks like a change.
  try {
    const hasReliableAdvisories = status.status !== 'unknown' && status.source !== 'crosscheck';
    if (hasReliableAdvisories) {
      const [prevRow] = await database
        .select({ advisories: statusSnapshots.advisories })
        .from(statusSnapshots)
        .where(
          and(
            ne(statusSnapshots.status, 'unknown'),
            or(eq(statusSnapshots.source, 'primary'), eq(statusSnapshots.source, 'fallback')),
          ),
        )
        .orderBy(desc(statusSnapshots.id))
        .limit(1);
      const prevAdvisories: string[] = prevRow?.advisories ? JSON.parse(prevRow.advisories) : [];
      const diff = diffAdvisories(prevAdvisories, status.advisories);
      if (diff.added.length > 0 || diff.removed.length > 0) {
        console.log('[poller] advisory diff', diff);
      }
    }
  } catch (err) {
    console.error('[poller] advisory diff step failed', err);
  }

  // Write the status row for this cycle. Always happens, regardless of
  // whether status resolved or came back 'unknown'.
  try {
    await database.insert(statusSnapshots).values({
      capturedAt,
      status: status.status,
      conditionText: status.conditionText,
      advisories: JSON.stringify(status.advisories),
      restrictions: JSON.stringify(status.restrictions),
      wydotReportTime: status.wydotReportTime,
      source: status.source,
    });
  } catch (err) {
    console.error('[poller] failed to write status snapshot', err);
  }

  // Step 3: weather.
  try {
    const html = await wydotFetch(SENSORS_URL, fetcher);
    const reading = html === null ? null : parseSensorPage(html);
    if (reading) {
      await database.insert(weatherSnapshots).values({
        capturedAt,
        airF: reading.airF,
        surfaceF: reading.surfaceF,
        windAvg: reading.windAvgMph,
        windGust: reading.windGustMph,
        windDir: reading.windDir,
        visibilityFt: reading.visibilityFt,
      });
    }
  } catch (err) {
    console.error('[poller] weather step failed', err);
  }

  // Step 4: travel times for all 12 route-directions, only inside the
  // polling window. Promise.allSettled so one route's failure can't affect
  // another's; a settled-but-null result (Google API failure) simply skips
  // that route's insert.
  try {
    if (inPollingWindow(nowMs)) {
      const routeRows = await database.select().from(routes);
      const settled = await Promise.allSettled(
        routeRows.map((route) => fetchRouteTime(env.GOOGLE_ROUTES_KEY, route, fetcher)),
      );
      for (let i = 0; i < routeRows.length; i++) {
        const result = settled[i];
        if (result.status !== 'fulfilled' || !result.value) continue;
        await database.insert(travelTimes).values({
          routeId: routeRows[i].id,
          capturedAt,
          durationSec: result.value.durationSec,
          staticDurationSec: result.value.staticDurationSec,
          distanceM: result.value.distanceM,
        });
      }
    }
  } catch (err) {
    console.error('[poller] travel times step failed', err);
  }

  // Step 5: Idaho 511 ID-33 events. null = fetch failed, leave stored
  // events untouched. [] = success with no events, clear every currently
  // active stored event. Non-empty = upsert: insert newly-seen events,
  // clear stored active events no longer present.
  try {
    const events = await fetchId33Events(env.IDAHO_511_KEY, fetcher);
    if (events !== null) {
      const activeRows = await database
        .select()
        .from(id33Events)
        .where(isNull(id33Events.clearedAt));
      const fetchedIds = new Set(events.map((e) => e.eventId));

      for (const row of activeRows) {
        if (row.eventId === null || !fetchedIds.has(row.eventId)) {
          await database
            .update(id33Events)
            .set({ clearedAt: capturedAt })
            .where(eq(id33Events.id, row.id));
        }
      }

      const activeIds = new Set(
        activeRows.map((r) => r.eventId).filter((id): id is string => id !== null),
      );
      for (const event of events) {
        if (activeIds.has(event.eventId)) continue;
        await database.insert(id33Events).values({
          capturedAt,
          eventId: event.eventId,
          description: event.description,
          isFullClosure: event.isFullClosure,
          clearedAt: null,
        });
      }
    }
  } catch (err) {
    console.error('[poller] idaho events step failed', err);
  }

  // Step 6: detours, only when the resolved status this cycle is 'closed'.
  try {
    if (status.status === 'closed') {
      const detours = await fetchDetours(fetcher);
      for (const detour of detours) {
        await database.insert(detourSnapshots).values({
          capturedAt,
          route: detour.route,
          conditionText: detour.conditionText,
        });
      }
    }
  } catch (err) {
    console.error('[poller] detour step failed', err);
  }
}
