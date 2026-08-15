import { useEffect, useRef, useState } from 'react';

import SeasonCompare from './components/SeasonCompare';
import TypicalChart from './components/TypicalChart';
import WorstDays from './components/WorstDays';
import { denverNow, todayToChartPoints, typicalsToChartPoints } from './historyChart';
import { getHistory } from './historyApi';
import type { ApiStatus, HistoryResult } from '../shared/types';

export default function HistoryPage() {
  const [routes, setRoutes] = useState<ApiStatus['travelTimes']>([]);
  const [direction, setDirection] = useState<'eb' | 'wb'>('eb');
  const [slug, setSlug] = useState<string | null>(null);
  const [data, setData] = useState<HistoryResult | null>(null);
  const mountedSlug = useRef<string | null>(null);

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
