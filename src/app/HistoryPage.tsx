import { useEffect, useState } from 'react';

import SeasonCompare from './components/SeasonCompare';
import TypicalChart, { type ChartPoint } from './components/TypicalChart';
import WorstDays from './components/WorstDays';
import { getHistory } from './historyApi';
import type { ApiStatus, HistoryResult } from '../shared/types';

/** Denver-local weekday-class + season for the client's current time. Same
 *  Nov-Apr/May-Oct split as the worker's tz.ts denverParts. */
function denverNow(): { weekdayClass: 'weekday' | 'weekend'; season: 'winter' | 'summer'; weekday: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Denver',
    weekday: 'long',
    month: 'numeric',
  }).formatToParts(new Date());
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? 'Monday';
  const month = Number(parts.find((p) => p.type === 'month')?.value ?? '1');
  return {
    weekday,
    weekdayClass: weekday === 'Saturday' || weekday === 'Sunday' ? 'weekend' : 'weekday',
    season: month >= 11 || month <= 4 ? 'winter' : 'summer',
  };
}

function denverHourOf(iso: string): number {
  return Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Denver',
      hour: 'numeric',
      hourCycle: 'h23',
    }).format(new Date(iso)),
  );
}

export default function HistoryPage() {
  const [routes, setRoutes] = useState<ApiStatus['travelTimes']>([]);
  const [direction, setDirection] = useState<'eb' | 'wb'>('eb');
  const [slug, setSlug] = useState<string | null>(null);
  const [data, setData] = useState<HistoryResult | null>(null);

  // Route list comes from /api/status so the tabs mirror DriveTimes exactly
  // -- History and Home never disagree about which routes matter.
  useEffect(() => {
    fetch('/api/status')
      .then((r) => r.json() as Promise<ApiStatus>)
      .then((s) => setRoutes(s.travelTimes))
      .catch(() => setRoutes([]));
  }, []);

  const visible = routes.filter((r) => r.slug.endsWith(`-${direction}`));
  const active = slug && visible.some((r) => r.slug === slug) ? slug : (visible[0]?.slug ?? null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    getHistory(active)
      .then((h) => !cancelled && setData(h))
      .catch(() => !cancelled && setData(null));
    return () => {
      cancelled = true;
    };
  }, [active]);

  const { weekday, weekdayClass, season } = denverNow();

  const points: ChartPoint[] = (data?.typicals ?? [])
    .filter((t) => t.weekdayClass === weekdayClass && t.season === season)
    .sort((a, b) => a.hour - b.hour)
    .map((t) => ({
      hour: t.hour,
      medianSec: t.medianSec,
      p25Sec: t.p25Sec,
      p75Sec: t.p75Sec,
      distinctDays: t.distinctDays,
    }));

  const today = (data?.today ?? []).map((r) => ({
    hour: denverHourOf(r.capturedAt),
    durationSec: r.durationSec,
  }));

  const recordingSince = data?.summary.worstDays?.length
    ? [...data.summary.worstDays].sort((a, b) => a.date.localeCompare(b.date))[0].date
    : null;

  return (
    <main className="bg-page min-h-screen pb-10">
      <div className="mx-auto max-w-[30rem] px-3.5 lg:max-w-[1080px] lg:px-7">
        <header className="flex items-center justify-between py-4">
          <div className="flex items-baseline gap-3.5">
            <span className="font-display text-[21px] font-extrabold tracking-tight">Teton Pass Cam</span>
            <span className="text-muted text-xs">History</span>
          </div>
          <a href="/" className="text-muted text-[13px] font-bold">
            ← Back to live conditions
          </a>
        </header>

        <h1 className="font-display text-[30px] font-extrabold tracking-tight">When should you leave?</h1>
        <p className="text-muted mt-1 text-sm">
          {`Travel time by hour of day — today's line against the typical band for a ${season} ${weekday}.`}
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {visible.map((r) => (
            <button
              key={r.slug}
              type="button"
              onClick={() => setSlug(r.slug)}
              className={
                r.slug === active
                  ? 'bg-btn-bg text-btn-ink rounded-full px-4 py-1.5 text-[13px] font-bold'
                  : 'bg-card border-card-border text-muted rounded-full border px-4 py-1.5 text-[13px]'
              }
            >
              {r.name}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setDirection((d) => (d === 'eb' ? 'wb' : 'eb'))}
            className="text-muted ml-auto text-[13px] font-bold"
          >
            Flip
          </button>
        </div>

        <section className="bg-card border-card-border mt-4 rounded-2xl border p-5">
          <div className="text-muted mb-2.5 flex flex-wrap gap-4 text-[11.5px]">
            <span>— Today</span>
            <span>▬ Typical band (p25–p75)</span>
            <span>— Typical median</span>
          </div>
          <TypicalChart points={points} today={today} />
          <p className="text-muted mt-2 text-[11.5px]">
            The band is shown only for hours with enough separate days of history behind them.
          </p>
        </section>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <WorstDays worstDays={data?.summary.worstDays ?? null} recordingSince={recordingSince} />
          <SeasonCompare
            seasonMedians={data?.summary.seasonMedians ?? null}
            closureDays={data?.summary.closureDays ?? null}
          />
        </div>
      </div>
    </main>
  );
}
