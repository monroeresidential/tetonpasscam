import { useEffect, useRef, useState } from 'react';

import ChartLegend, { type LegendItem } from './components/ChartLegend';
import Segmented from './components/Segmented';
import SeasonCompare from './components/SeasonCompare';
import TempUnitToggle from './components/TempUnitToggle';
import TypicalChart, { type ChartPoint } from './components/TypicalChart';
import WorstDays from './components/WorstDays';
import { denverFractionalHourOf, denverNow, todayToChartPoints, typicalsToChartPoints } from './historyChart';
import { getHistory } from './historyApi';
import { formatTemp, useTempUnit } from './units';
import { getWeatherHistory } from './weatherHistoryApi';
import type {
  ApiStatus,
  HistoryResult,
  WeatherHistoryResult,
  WeatherMetric,
  WeatherTypical,
} from '../shared/types';

// Legend definitions live beside the page that renders them, but the
// swatch rendering is shared (ChartLegend) so no two charts can disagree
// about what a series looks like. Colours are the SAME tokens TypicalChart
// strokes with -- accent for today, status-open for the typical series,
// muted for the dashed secondary.
const TYPICAL = 'var(--color-status-open)';
const TODAY = 'var(--color-accent)';

const DRIVE_TIME_LEGEND: LegendItem[] = [
  { label: 'Today', kind: 'line', color: TODAY },
  { label: 'Typical day', kind: 'line', color: TYPICAL },
  { label: 'Typical range', kind: 'band', color: TYPICAL },
];

// "Today (air)" rather than plain "Today": only air carries a today trace
// here, surface is plotted as a typical median alone, and a bare "Today"
// would leave a reader guessing which of the two it tracks.
const TEMP_LEGEND: LegendItem[] = [
  { label: 'Today (air)', kind: 'line', color: TODAY },
  { label: 'Air, typical', kind: 'line', color: TYPICAL },
  { label: 'Typical range', kind: 'band', color: TYPICAL },
  { label: 'Road surface, typical', kind: 'dashed', color: 'var(--color-muted)' },
];

// → WY tracks eb (Idaho -> Jackson side); → ID tracks wb (Jackson -> Idaho
// side). Two Idaho destinations exist from Jackson (Victor, Driggs), so this
// toggle picks the side and the route select below it picks the exact pair.
const DIRECTION_OPTIONS = [
  { value: 'eb', label: '→ WY' },
  { value: 'wb', label: '→ ID' },
] as const;

/** Filters `/api/weather-history`'s `typicals` -- every (metric,
 *  weekday-class, hour, season) bucket, station-wide -- down to the ONE
 *  metric AND population matching `weekdayClass`/`season`, same reasoning as
 *  `typicalsToChartPoints`: skipping either half of the filter plots unrelated
 *  populations at the same x-coordinate. */
function tempPoints(
  typicals: WeatherTypical[],
  metric: WeatherMetric,
  weekdayClass: 'weekday' | 'weekend',
  season: 'winter' | 'summer',
): ChartPoint[] {
  return typicals
    .filter((t) => t.metric === metric && t.weekdayClass === weekdayClass && t.season === season)
    .sort((a, b) => a.hour - b.hour)
    .map((t) => ({
      hour: t.hour,
      median: t.median,
      p25: t.p25,
      p75: t.p75,
      distinctDays: t.distinctDays,
    }));
}

export default function HistoryPage() {
  const [routes, setRoutes] = useState<ApiStatus['travelTimes']>([]);
  const [direction, setDirection] = useState<'eb' | 'wb'>('eb');
  const [slug, setSlug] = useState<string | null>(null);
  const [data, setData] = useState<HistoryResult | null>(null);
  const [weather, setWeather] = useState<WeatherHistoryResult | null>(null);
  const { unit, setUnit } = useTempUnit();
  const mountedSlug = useRef<string | null>(null);

  // Route list comes from /api/status so the tabs mirror DriveTimes exactly
  // -- History and Home never disagree about which routes matter.
  useEffect(() => {
    fetch('/api/status')
      .then((r) => r.json() as Promise<ApiStatus>)
      .then((s) => setRoutes(s.travelTimes))
      .catch(() => setRoutes([]));
  }, []);

  // Station-wide, unlike the per-route history above -- takes no route
  // parameter, so it belongs in its own mount-once effect rather than the
  // per-slug one.
  useEffect(() => {
    getWeatherHistory()
      .then(setWeather)
      .catch(() => setWeather(null));
  }, []);

  const visible = routes.filter((r) => r.slug.endsWith(`-${direction}`));
  const active = slug && visible.some((r) => r.slug === slug) ? slug : (visible[0]?.slug ?? null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    // A route-tab switch must never leave the previous route's chart/tables
    // on screen under the new tab -- clear up front, same fix as
    // HomeHistoryCard's mountedSlug guard. Skipped on first mount (state is
    // already empty) to avoid an extra render for no visual change.
    if (mountedSlug.current !== null && mountedSlug.current !== active) {
      setData(null);
    }
    mountedSlug.current = active;
    getHistory(active, { summary: true })
      .then((h) => !cancelled && setData(h))
      .catch(() => !cancelled && setData(null));
    return () => {
      cancelled = true;
    };
  }, [active]);

  const { weekday, weekdayClass, season } = denverNow();

  const points = typicalsToChartPoints(data?.typicals ?? [], weekdayClass, season);
  const today = todayToChartPoints(data?.today ?? []);

  const airPoints = tempPoints(weather?.typicals ?? [], 'air_f', weekdayClass, season);
  const surfacePoints = tempPoints(weather?.typicals ?? [], 'surface_f', weekdayClass, season);
  const tempToday = (weather?.today ?? [])
    .filter((r) => r.airF !== null)
    .map((r) => ({ hour: denverFractionalHourOf(r.capturedAt), value: r.airF as number }));

  return (
    <main className="bg-page min-h-screen pb-10">
      <div className="mx-auto max-w-[30rem] px-3.5 lg:max-w-[960px] lg:px-7">
        <header className="flex items-center justify-between py-4">
          <div className="flex items-baseline gap-3.5">
            <span className="font-display text-[21px] font-extrabold tracking-tight">Teton Pass Cam</span>
            <span className="text-muted text-xs">History</span>
          </div>
          <a href="/" className="text-muted text-[13px] font-bold whitespace-nowrap">
            ← Live
          </a>
        </header>

        <h1 className="font-display text-[24px] font-extrabold tracking-tight">When should you leave?</h1>
        <p className="text-muted mt-1 text-sm">
          {`Travel time by hour of day — today's line against the typical range for a ${season} ${weekday}.`}
        </p>

        <div className="mt-4 flex gap-2">
          <div className="relative min-w-[200px] flex-1">
            <select
              aria-label="Route"
              value={active ?? ''}
              onChange={(e) => setSlug(e.target.value)}
              className="bg-card border-card-border box-border h-11 w-full appearance-none rounded-[12px] border py-0 pr-8 pl-3 font-display text-sm font-bold"
            >
              {visible.map((r) => (
                <option key={r.slug} value={r.slug}>
                  {r.name}
                </option>
              ))}
            </select>
            {/* Drawn as an inline SVG rather than baked into a data-URI
                background image the way the prototype does it: a data URI's
                stroke colour is fixed at author time, and the prototype's
                #a39880 is only the DARK-mode value of `--color-muted` (see
                index.css) -- hardcoding it would go low-contrast the moment
                a reader is in light mode. An SVG element's stroke can
                reference the token directly and follow the theme like every
                other colour on this page. */}
            <svg
              aria-hidden="true"
              viewBox="0 0 12 8"
              className="pointer-events-none absolute top-1/2 right-3 h-2 w-3 -translate-y-1/2"
            >
              <path d="M1 1l5 5 5-5" stroke="var(--color-muted)" strokeWidth="2" fill="none" />
            </svg>
          </div>
          <Segmented options={DIRECTION_OPTIONS} value={direction} onChange={setDirection} ariaLabel="Direction" />
        </div>

        <section className="bg-card border-card-border mt-4 rounded-2xl border p-5">
          <TypicalChart points={points} today={today} yAxisTitle="Travel time (min)" />
          <div className="mt-2.5">
            <ChartLegend items={DRIVE_TIME_LEGEND} />
          </div>
        </section>

        <section data-testid="temp-card" className="bg-card border-card-border mt-4 rounded-2xl border p-5">
          <h2 className="font-display text-[20px] font-extrabold tracking-tight">Summit temperature</h2>
          <div className="mt-4">
            <TypicalChart
              points={airPoints}
              today={tempToday}
              secondary={surfacePoints}
              formatValue={(v) => formatTemp(v, unit)}
              referenceValue={{ value: 32, label: 'Freezing' }}
              ariaLabel="Summit temperature by hour of day, today's air reading against the typical range"
              emptyMessage="Temperature history is still being collected for this station."
              yAxisTitle={`Temperature (°${unit})`}
            />
          </div>
          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
            <ChartLegend items={TEMP_LEGEND} />
            <TempUnitToggle unit={unit} onChange={setUnit} />
          </div>
        </section>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <WorstDays worstDays={data?.summary?.worstDays ?? null} />
          <SeasonCompare
            seasonMedians={data?.summary?.seasonMedians ?? null}
            closureDays={data?.summary?.closureDays ?? null}
          />
        </div>
      </div>
    </main>
  );
}
