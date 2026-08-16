import { denverDateKey } from '../tz';

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
const RAIN_RX = /rain|drizzle/;

/**
 * Map an NWS `shortForecast` string to one of the eight categories.
 *
 * Order is load-bearing. Thunderstorms are checked first because NWS always
 * names the precipitation alongside them ("Rain Showers And Thunderstorms")
 * and the storm is the headline. Mixed is checked before snow because
 * "Rain And Snow" matches both token sets and mixed is the truer answer.
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
  // Only classify as mixed when both precipitation types are explicitly named
  // together (e.g., "Rain And Snow", not "Freezing Rain")
  if (snowy && rainy && s.includes('and')) return 'mixed';
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
