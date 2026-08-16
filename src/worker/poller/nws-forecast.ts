import { denverDateKey } from '../tz';
import { db, forecastDays } from '../db';
import type { Env } from '../env';

/** The eight display categories a forecast day collapses to. Moved to
 *  `src/shared/types.ts` in Task 5 once the client needs it too. */
export type ForecastCategory =
  | 'clear'
  | 'partly-cloudy'
  | 'cloudy'
  | 'rain'
  | 'snow'
  | 'mixed'
  | 'thunderstorm'
  | 'fog';

/** One period from api.weather.gov's `/forecast/hourly`. Only the fields the
 *  rollup reads are declared; the real payload carries more. Optional/null
 *  on everything NWS can legitimately omit -- a single blank field must not
 *  discard an otherwise good day, the same rule the WYDOT sensor parser
 *  follows. */
export interface HourlyPeriod {
  startTime: string;
  isDaytime: boolean;
  temperature: number;
  temperatureUnit: string;
  probabilityOfPrecipitation: { value: number | null } | null;
  windSpeed: string | null;
  icon: string | null;
  shortForecast: string | null;
}

export interface DailyForecast {
  date: string; // America/Denver yyyy-mm-dd
  highF: number | null;
  lowF: number | null;
  category: ForecastCategory;
  iconUrl: string | null;
  shortForecast: string | null;
  precipPct: number | null;
  windGustMph: number | null;
}

/**
 * Tie-break order for the daily category vote: on a day split evenly between
 * two conditions, the more hazardous one wins. This is a mountain pass in a
 * state where the road legally closes -- an icon that under-reports the
 * hazard is the expensive direction to be wrong in.
 */
const SEVERITY: Record<ForecastCategory, number> = {
  thunderstorm: 7,
  snow: 6,
  mixed: 5,
  rain: 4,
  fog: 3,
  cloudy: 2,
  'partly-cloudy': 1,
  clear: 0,
};

const SNOW_RX = /snow|flurr|sleet|wintry|freezing|ice pellets/;
const RAIN_RX = /rain|shower|drizzle/;

/**
 * Map an NWS `shortForecast` string to one of the eight categories.
 *
 * Order is load-bearing. Thunderstorms are checked first because NWS always
 * names the precipitation alongside them ("Rain Showers And Thunderstorms")
 * and the storm is the headline. Mixed is checked before snow because
 * "Rain And Snow" matches both token sets and mixed is the truer answer.
 *
 * When both snowy and rainy tokens are present, only classify as mixed if an
 * explicit conjunction appears. "Freezing Rain" contains both "freezing"
 * (SNOW_RX) and "rain" (RAIN_RX) but describes a single hazardous phenomenon
 * (frozen precipitation), so it returns snow. "Rain And Snow" contains an
 * explicit "and" and represents two separate precipitation types, so it
 * returns mixed. This distinction matters for a mountain pass.
 *
 * Unrecognized text falls back to `cloudy` rather than `clear`: this feeds a
 * severity tie-break, and the failure mode of guessing "clear" on an unknown
 * winter string is exactly the one worth avoiding. Nothing is lost by the
 * fallback -- the original text is carried through as `shortForecast` and
 * becomes the icon's alt text.
 */
export function categorize(shortForecast: string | null): ForecastCategory {
  if (!shortForecast) return 'cloudy';
  const s = shortForecast.toLowerCase();

  if (s.includes('thunder')) return 'thunderstorm';
  const snowy = SNOW_RX.test(s);
  const rainy = RAIN_RX.test(s);
  if (snowy && rainy && /\band\b/.test(s)) return 'mixed';
  if (snowy) return 'snow';
  if (rainy) return 'rain';
  if (/fog|haze|smoke/.test(s)) return 'fog';
  if (s.includes('partly')) return 'partly-cloudy';
  if (s.includes('cloudy') || s.includes('overcast')) return 'cloudy';
  if (s.includes('sunny') || s.includes('clear')) return 'clear';
  return 'cloudy';
}

/**
 * NWS reports wind as a display string (`"6 mph"`, `"5 to 10 mph"`), never a
 * number, so this must parse rather than cast. A range yields its top --
 * the gust figure is the one a driver plans around.
 */
export function parseWindMph(windSpeed: string | null): number | null {
  if (!windSpeed) return null;
  const numbers = windSpeed.match(/\d+/g);
  if (!numbers) return null;
  return Math.max(...numbers.map(Number));
}

function toF(temperature: number, unit: string): number {
  return unit.toUpperCase() === 'C' ? temperature * 1.8 + 32 : temperature;
}

/** Fewer periods than this on the LAST day of the window ⇒ drop it. See
 *  rollupDaily. */
const MIN_TRAILING_PERIODS = 12;

/**
 * Collapse ~156 hourly periods into one row per America/Denver calendar day.
 *
 * Bucketing uses `denverDateKey`, never `toISOString().slice(0,10)`: a 23:00
 * Denver hour is 05:00Z the next day, so a UTC bucketer would shift half of
 * every evening onto the following card.
 */
export function rollupDaily(periods: HourlyPeriod[]): DailyForecast[] {
  const byDate = new Map<string, HourlyPeriod[]>();
  for (const p of periods) {
    const ms = Date.parse(p.startTime);
    if (!Number.isFinite(ms)) continue;
    const key = denverDateKey(ms);
    const bucket = byDate.get(key);
    if (bucket) bucket.push(p);
    else byDate.set(key, [p]);
  }

  const dates = [...byDate.keys()].sort();

  // The window ends mid-evening, so its final day holds only a handful of
  // hours and would report a "high" computed from those -- read as a cold
  // snap. This applies to the TRAILING day only: today is always kept
  // however few hours remain, because a strip whose first card silently
  // became tomorrow is actively misleading.
  const last = dates[dates.length - 1];
  if (last !== undefined && dates.length > 1 && byDate.get(last)!.length < MIN_TRAILING_PERIODS) {
    dates.pop();
  }

  return dates.map((date) => {
    const all = byDate.get(date)!;

    // A day polled after dark has no daytime periods at all; fall back to
    // the whole day rather than emitting a default category.
    const daylight = all.filter((p) => p.isDaytime);
    const voters = daylight.length > 0 ? daylight : all;

    const counts = new Map<ForecastCategory, number>();
    for (const p of voters) {
      const c = categorize(p.shortForecast);
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    let category: ForecastCategory = 'cloudy';
    let best = -1;
    for (const [c, n] of counts) {
      if (n > best || (n === best && SEVERITY[c] > SEVERITY[category])) {
        category = c;
        best = n;
      }
    }

    // Icon comes from a period that actually matches the winning category,
    // so the picture and the category can never disagree.
    const winner = voters.find((p) => categorize(p.shortForecast) === category) ?? null;

    const temps = all.map((p) => toF(p.temperature, p.temperatureUnit)).filter(Number.isFinite);
    const pops = all
      .map((p) => p.probabilityOfPrecipitation?.value)
      .filter((v): v is number => typeof v === 'number');
    const winds = all
      .map((p) => parseWindMph(p.windSpeed))
      .filter((v): v is number => v !== null);

    return {
      date,
      highF: temps.length ? Math.round(Math.max(...temps)) : null,
      lowF: temps.length ? Math.round(Math.min(...temps)) : null,
      category,
      iconUrl: winner?.icon ?? null,
      shortForecast: winner?.shortForecast ?? null,
      precipPct: pops.length ? Math.max(...pops) : null,
      windGustMph: winds.length ? Math.max(...winds) : null,
    };
  });
}

/**
 * NWS grid for the Teton Pass summit (43.4986,-110.9564), resolved once from
 * `/points/{lat},{lon}` on 2026-08-16 rather than re-resolved every cycle.
 *
 * The resolved cell self-reports an elevation of 2582.88 m (8,474 ft), which
 * is the check that matters for a mountain forecast: a neighbouring cell 6 km
 * west covers Wilson at ~6,200 ft and would forecast a different mountain.
 * If this constant is ever changed, re-verify that elevation.
 */
export const NWS_GRID = { office: 'RIW', x: 35, y: 140 } as const;

const NWS_HOURLY_URL = `https://api.weather.gov/gridpoints/${NWS_GRID.office}/${NWS_GRID.x},${NWS_GRID.y}/forecast/hourly`;

/** The summit point `NWS_GRID` was resolved from. Only used to re-resolve
 *  the grid if the hardcoded triple ever 404s. */
const NWS_POINT_URL = 'https://api.weather.gov/points/43.4986,-110.9564';

const NWS_USER_AGENT = 'tetonpasscam.com poller (drew@monroeresidential.com)';

/**
 * Minimum age of the newest stored row before we fetch again.
 *
 * NWS regenerates these forecasts roughly hourly (`generatedAt` /
 * `updateTime` in the payload), so polling at the cycle's own 10-minute
 * cadence would pull identical bytes six times per update. Hourly is no less
 * current and is a better neighbour to a free, unauthenticated public API.
 */
export const FORECAST_REFRESH_MIN = 60;

/**
 * One NWS GET with the same etiquette as `wydotFetch`: descriptive
 * User-Agent with a contact address, 30s timeout, one retry after ~2s on 5xx
 * or throw. Returns the parsed JSON body, or `{ notFound: true }` so a 404
 * stays distinguishable from a plain failure -- the grid fallback below
 * depends on telling those two apart.
 */
async function nwsGetJson(
  url: string,
  fetcher: typeof fetch,
): Promise<{ body: unknown } | { notFound: true } | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetcher(url, {
        headers: { 'User-Agent': NWS_USER_AGENT, Accept: 'application/geo+json' },
        signal: AbortSignal.timeout(30_000),
      });
      if (response.ok) return { body: await response.json() };
      if (response.status === 404) return { notFound: true };
      if (response.status >= 500 && attempt === 0) {
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      return null;
    } catch {
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      return null;
    }
  }
  return null;
}

function readPeriods(body: unknown): HourlyPeriod[] | null {
  const periods = (body as { properties?: { periods?: HourlyPeriod[] } } | null)?.properties
    ?.periods;
  return Array.isArray(periods) ? periods : null;
}

/**
 * Fetch the hourly forecast. Returns null on any failure -- callers treat
 * null as "no forecast this cycle", never as "no forecast exists".
 *
 * A 404 on the hardcoded gridpoint means NWS has re-gridded and retired that
 * cell, which is a different problem from a fetch failure: the forecast still
 * exists, our address for it is stale. So a 404 (and only a 404) triggers one
 * re-resolve through `/points`, using the `forecastHourly` URL it hands back.
 * The re-resolved URL is used for this cycle only and never persisted --
 * a permanent re-grid should be fixed by updating `NWS_GRID`, and the
 * console.warn is what makes that visible instead of silently paying an
 * extra round trip forever.
 */
export async function fetchHourlyPeriods(fetcher: typeof fetch): Promise<HourlyPeriod[] | null> {
  const first = await nwsGetJson(NWS_HOURLY_URL, fetcher);
  if (first && 'body' in first) return readPeriods(first.body);
  if (!first || !('notFound' in first)) return null;

  console.warn('[poller] NWS gridpoint 404 -- re-resolving grid via /points', NWS_GRID);
  const points = await nwsGetJson(NWS_POINT_URL, fetcher);
  if (!points || !('body' in points)) return null;

  const hourlyUrl = (points.body as { properties?: { forecastHourly?: string } } | null)?.properties
    ?.forecastHourly;
  // Only follow a URL on the host we already trust -- `forecastHourly` is
  // upstream-controlled, and this value is about to become a fetch target.
  if (typeof hourlyUrl !== 'string' || !hourlyUrl.startsWith('https://api.weather.gov/')) {
    return null;
  }

  // Deliberately NOT recursive: exactly one re-resolve per cycle, so a
  // persistent 404 on both addresses fails fast instead of looping.
  const second = await nwsGetJson(hourlyUrl, fetcher);
  if (!second || !('body' in second)) return null;
  return readPeriods(second.body);
}

/**
 * One forecast refresh, self-throttled to `FORECAST_REFRESH_MIN`. Safe to
 * call on every poll cycle -- inside the window it returns without touching
 * the network.
 */
export async function runForecastStep(
  env: Env,
  fetcher: typeof fetch,
  nowMs: number,
): Promise<void> {
  const newest = (await env.DB.prepare(
    'SELECT MAX(fetched_at) AS fetchedAt FROM forecast_days',
  ).first()) as { fetchedAt: string | null } | null;

  if (newest?.fetchedAt) {
    const ageMs = nowMs - Date.parse(newest.fetchedAt);
    // A NaN age (unparseable stored timestamp) falls through to a fetch --
    // refreshing on a corrupt marker is the harmless direction to err.
    if (Number.isFinite(ageMs) && ageMs < FORECAST_REFRESH_MIN * 60_000) return;
  }

  const periods = await fetchHourlyPeriods(fetcher);
  if (!periods) return;

  const days = rollupDaily(periods);
  if (days.length === 0) return;

  const fetchedAt = new Date(nowMs).toISOString();
  const database = db(env);

  // A single db.batch() rather than a sequential per-day loop: D1 runs a
  // batch as one transaction, so a mid-loop failure (day k throws) can no
  // longer leave days 0..k-1 committed with a fresh fetchedAt while the rest
  // keep stale data -- that partial-write state is what let a genuinely
  // failed cycle look "fresh" to the next cycle's MAX(fetched_at) throttle
  // check above, silently suppressing the retry that should have happened.
  // `days.length === 0` already returned above, so this array is always
  // non-empty, satisfying db.batch()'s non-empty-tuple requirement.
  const statements = days.map((day) =>
    database
      .insert(forecastDays)
      .values({
        date: day.date,
        highF: day.highF,
        lowF: day.lowF,
        category: day.category,
        iconUrl: day.iconUrl,
        shortForecast: day.shortForecast,
        precipPct: day.precipPct,
        windGustMph: day.windGustMph,
        fetchedAt,
      })
      .onConflictDoUpdate({
        target: forecastDays.date,
        set: {
          highF: day.highF,
          lowF: day.lowF,
          category: day.category,
          iconUrl: day.iconUrl,
          shortForecast: day.shortForecast,
          precipPct: day.precipPct,
          windGustMph: day.windGustMph,
          fetchedAt,
        },
      }),
  );
  await database.batch(statements as [(typeof statements)[number], ...(typeof statements)[number][]]);
}
