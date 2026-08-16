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
import { runForecastStep } from './nws-forecast';
import {
  diffAdvisories,
  parseRoadClosures,
  parseRoutesResults,
  parseStatewide,
  type ResolvedStatus,
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

/** Where a definite status sits on the only axis that safety cares about:
 *  can you drive it or not. 'open' and 'restricted' both mean "passable" --
 *  they can disagree with each other on HOW restricted without that being a
 *  trust-relevant conflict, but either one disagreeing with 'closed' is
 *  exactly the conflict this module exists to catch. Returns null for
 *  'unknown' (no opinion to place on the axis at all). */
function passAxis(status: StatusResult['status']): 'closed' | 'passable' | null {
  if (status === 'closed') return 'closed';
  if (status === 'open' || status === 'restricted') return 'passable';
  return null;
}

function dedupeAppend(base: string[], extra: string[]): string[] {
  const out = [...base];
  for (const item of extra) {
    if (!out.includes(item)) out.push(item);
  }
  return out;
}

/** Older (earlier) of two ISO timestamps, treating a null or unparseable
 *  value as absent rather than "infinitely old"/"infinitely new" -- an
 *  absent side simply defers to whichever side has a usable value. Picking
 *  the OLDER of the two (rather than always primary's, as before) is the
 *  conservative choice for a merged report: a driver reading `wydotReportTime`
 *  as "how current is this" should never see a timestamp fresher than the
 *  least-current source that contributed to the merged status. */
function olderReportTime(a: string | null, b: string | null): string | null {
  const aMs = a === null ? NaN : Date.parse(a);
  const bMs = b === null ? NaN : Date.parse(b);
  if (!Number.isFinite(aMs)) return Number.isFinite(bMs) ? b : null;
  if (!Number.isFinite(bMs)) return a;
  return aMs <= bMs ? a : b;
}

/** Merge two DEFINITE StatusResults that AGREE on `passAxis` (both
 *  'closed', or both in {'open','restricted'}) into one. Within an
 *  agreeing 'passable' pair, the more restrictive of the two wins
 *  (open+restricted -> restricted; open+open -> open); a 'closed' pair can
 *  only ever agree with another 'closed'.
 *
 *  Advisories come from whichever side's OWN status matches the merged
 *  `status` (the "winning" side) -- not a union of both. A union would let
 *  a less-restrictive source's advisory list bleed into a report that's
 *  really describing the other, more-restrictive source's conditions.
 *  When both sides already agree exactly (open+open, or one side is the
 *  sole source of the merged status because the other was more permissive
 *  and lost), primary's advisories are used, matching the historical
 *  'primary'-favoring default. Restrictions, by contrast, stay a deduped
 *  union of both sources (primary's entries first) -- a driver must never
 *  lose a real restriction just because only the fallback page reported it,
 *  and unlike advisories a restriction isn't tied to which side "won" the
 *  open/closed axis.
 *
 *  `wydotReportTime` is the OLDER of the two sources' report times (see
 *  `olderReportTime`) -- conservative, since the merged report is only as
 *  current as its least-current input. `primary`'s conditionText wins, and
 *  the reported source stays 'primary' -- it's still the authoritative
 *  page, fallback here only ever narrows/corroborates it, never overrides
 *  it. */
function mergeAgreeing(primary: StatusResult, fallback: StatusResult): StatusResult {
  const status: StatusResult['status'] =
    primary.status === 'closed' || fallback.status === 'closed'
      ? 'closed'
      : primary.status === 'restricted' || fallback.status === 'restricted'
        ? 'restricted'
        : 'open';
  const advisories =
    fallback.status === status && primary.status !== status ? fallback.advisories : primary.advisories;
  return {
    status,
    conditionText: primary.conditionText,
    advisories,
    restrictions: dedupeAppend(primary.restrictions, fallback.restrictions),
    wydotReportTime: olderReportTime(primary.wydotReportTime, fallback.wydotReportTime),
    source: 'primary',
  };
}

/** Consult the Statewide cross-check page as a last resort. It may only ever
 *  ESCALATE to 'closed' -- it can never establish that the pass is passable.
 *
 *  The allowlist used to be ('closed' | 'restricted'), guarding only against
 *  a literal 'open'. That was a half-measure, because 'restricted' sits on
 *  the same PASSABLE axis as 'open' (see `passAxis`), and it failed open in
 *  production: on a closure day the primary RoadClosures page flips to
 *  CLOSED first while RoutesResults lags reporting open, and Statewide
 *  returns 'restricted' for the standing 'Falling Rock' advisory that has
 *  sat on this segment all summer. The disagreement path below then resolved
 *  a definite, authoritative closure to an amber RESTRICTED banner carrying
 *  live drive times and none of the "Closed -- do not attempt" legal copy
 *  that a Wyoming closure (W.S. 24-1-109) requires. No attacker needed.
 *
 *  Statewide is the weakest of the three sources and structurally cannot
 *  prove passability: its own parser documents that the page "only ever
 *  lists problem segments, it has no explicit 'open' list", so the absence
 *  of a closure heading there means nothing, and the presence of an advisory
 *  heading means only that an advisory exists. It can corroborate a closure.
 *  That is all it can do, and now all it is permitted to do.
 *
 *  Returns null when Statewide can't resolve it (fetch failure, no
 *  recognizable verdict, or any non-'closed' verdict) -- callers then report
 *  'unknown', which is the spec's answer for an unresolved conflict and
 *  whose UI withholds drive times and points at Wyoming 511. */
async function consultStatewide(fetcher: typeof fetch): Promise<'closed' | null> {
  try {
    const html = await wydotFetch(STATEWIDE_URL, fetcher);
    const statewideStatus = html === null ? 'unknown' : parseStatewide(html);
    return statewideStatus === 'closed' ? 'closed' : null;
  } catch {
    return null;
  }
}

/**
 * Resolve the current Teton Pass status. Both the primary source
 * (RoadClosures.html) and the fallback source
 * (RoutesResults?SelectedRoute=WY22) are fetched EVERY cycle -- not only
 * when primary comes back 'unknown' -- because a definite primary can still
 * be a misparse or a genuine WYDOT inconsistency, and the only way to ever
 * catch that (per the spec's cross-check requirement) is to have a second
 * opinion in hand every single cycle, not just when the first one already
 * gave up. Decision matrix:
 *
 *   1. Primary definite, fallback unknown -> accept primary (source
 *      'primary'). A fallback-page hiccup must never degrade a healthy
 *      primary read.
 *   2. Primary unknown, fallback definite -> accept fallback (source
 *      'fallback').
 *   3. Both definite and AGREE on the open-vs-closed axis (open+restricted
 *      counts as agreeing -- both passable) -> merge them, preferring the
 *      more restrictive status and the union of both sources'
 *      advisories/restrictions (source 'primary'; see mergeAgreeing).
 *   4. Both definite and DISAGREE on the open-vs-closed axis (one says
 *      closed, the other says open/restricted) -- this is the exact
 *      scenario a primary-only read can never catch, and is why fallback is
 *      now fetched unconditionally. Consult the Statewide crosscheck: if it
 *      corroborates a CLOSURE, use that (source 'crosscheck'); anything
 *      else leaves the cycle genuinely unresolved (source 'unresolved',
 *      status 'unknown').
 *      INVARIANT: this path must NEVER resolve onto the PASSABLE axis --
 *      not 'open' and not 'restricted'. consultStatewide hands back only
 *      'closed' | null, by construction, so the crosscheck can escalate a
 *      closure but can never license passage. A definite CLOSED from the
 *      authoritative primary is never downgraded here; when the crosscheck
 *      is silent the answer is UNKNOWN, whose UI withholds drive times.
 *   5. Both unknown -> neither source has an opinion to agree or disagree
 *      with, so as a last resort consult Statewide the same way; only a
 *      corroborated closure counts, and if it can't resolve one, report
 *      'unknown' (source 'primary', kept as the historical label for this
 *      specific both-failed path so existing snapshots/tests that depend on
 *      it are undisturbed). A standing advisory on the statewide page is
 *      NOT evidence of passability and no longer produces 'restricted'.
 */
export async function resolveStatus(fetcher: typeof fetch): Promise<ResolvedStatus> {
  let primary: StatusResult;
  try {
    const html = await wydotFetch(ROAD_CLOSURES_URL, fetcher);
    primary = html === null ? unknownStatusResult('primary') : parseRoadClosures(html);
  } catch {
    primary = unknownStatusResult('primary');
  }

  let fallback: StatusResult;
  try {
    const html = await wydotFetch(ROUTESRESULTS_WY22_URL, fetcher);
    fallback = html === null ? unknownStatusResult('fallback') : parseRoutesResults(html);
  } catch {
    fallback = unknownStatusResult('fallback');
  }

  // The road-surface description ("Dry", "Snow packed", ...) comes from the
  // FALLBACK page's Conditions cell -- the primary page's own condition text
  // is open/closed wording ("Road Open"), a different thing entirely.
  //
  // Attached here, at every exit, rather than inside `mergeAgreeing`: that
  // function only handles the both-definite-and-agreeing path, and the
  // description matters just as much on the paths where it doesn't run. In
  // particular, when the two pages DISAGREE the status resolves via
  // Statewide (or to unresolved) and `mergeAgreeing` is never called -- yet
  // that is precisely when a driver most wants to read that the road is
  // snow-packed. Wiring this into the merge alone would drop it exactly
  // there. `fallback.conditionText` is already null whenever the fallback
  // page failed to fetch or its segment row wasn't found, so no extra
  // guard is needed for those cases.
  const withSurface = (result: StatusResult): ResolvedStatus => ({
    ...result,
    surfaceConditionText: fallback.conditionText,
  });

  const primaryAxis = passAxis(primary.status);
  const fallbackAxis = passAxis(fallback.status);

  if (primaryAxis !== null && fallbackAxis === null) return withSurface(primary);
  if (primaryAxis === null && fallbackAxis !== null) return withSurface(fallback);

  if (primaryAxis !== null && fallbackAxis !== null) {
    if (primaryAxis === fallbackAxis) return withSurface(mergeAgreeing(primary, fallback));

    // Disagreement: one authoritative page says closed, the other says
    // open/restricted. Never resolve this as 'open' -- consult Statewide.
    const crosscheck = await consultStatewide(fetcher);
    if (crosscheck) return withSurface({ ...unknownStatusResult('crosscheck'), status: crosscheck });
    return withSurface(unknownStatusResult('unresolved'));
  }

  // Both unknown.
  const crosscheck = await consultStatewide(fetcher);
  if (crosscheck) return withSurface({ ...unknownStatusResult('crosscheck'), status: crosscheck });
  return withSurface(unknownStatusResult('primary'));
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
  let status: ResolvedStatus;
  try {
    status = await resolveStatus(fetcher);
  } catch (err) {
    console.error('[poller] resolveStatus threw', err);
    // surfaceConditionText null on this path for the same reason the whole
    // result is 'unknown': resolveStatus blew up, so there is no fallback
    // parse to describe the road surface from.
    status = { ...unknownStatusResult('primary'), surfaceConditionText: null };
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
      surfaceConditionText: status.surfaceConditionText,
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
        humidityPct: reading.humidityPct,
        dewPointF: reading.dewPointF,
        // The parser's own WYDOT-report timestamp, distinct from
        // `capturedAt` (this poller cycle's fetch time) -- see LH T2
        // finding 4's survey: previously there was no column for this, so
        // `capturedAt` got relabeled as `reportedAt` at the API layer.
        reportedAt: reading.reportedAt,
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

  // Step 7: NWS forecast. Self-throttled to FORECAST_REFRESH_MIN, so calling
  // it every cycle costs one indexed MAX() most of the time. Wrapped like
  // every other step: a forecast failure must never affect the status row
  // written above.
  try {
    await runForecastStep(env, fetcher, nowMs);
  } catch (err) {
    console.error('[poller] forecast step failed', err);
  }
}
