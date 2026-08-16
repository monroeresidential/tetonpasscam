import { useEffect, useRef, useState } from 'react';

import ChartLegend, { type LegendItem } from './ChartLegend';
import TypicalChart, { type ChartPoint } from './TypicalChart';
import { denverNow, todayToChartPoints, typicalsToChartPoints } from '../historyChart';
import { getHistory } from '../historyApi';

// Same three series, same colours, same shared component as the drive-time
// chart on /history -- this card plots exactly that data, so the two must
// not describe it differently. The explaining caption is deliberately NOT
// repeated here: this is a teaser and the sentence would dominate it, and
// the card links through to the page that carries it.
const HOME_LEGEND: LegendItem[] = [
  { label: 'Today', kind: 'line', color: 'var(--color-accent)' },
  { label: 'Typical day', kind: 'line', color: 'var(--color-status-open)' },
  { label: 'Typical range', kind: 'band', color: 'var(--color-status-open)' },
];

export default function HomeHistoryCard({ slug, routeName }: { slug: string; routeName: string }) {
  const [points, setPoints] = useState<ChartPoint[]>([]);
  const [today, setToday] = useState<{ hour: number; value: number }[]>([]);
  const mountedSlug = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // A slug change (e.g. a direction flip) must never leave the previous
    // route's chart on screen under the new route's card -- clear it up
    // front so TypicalChart falls back to "No history for this route yet."
    // until the new response lands, or for good if the fetch rejects.
    // Skipped on first mount, where state is already empty, to avoid an
    // extra render for no visual change.
    if (mountedSlug.current !== null && mountedSlug.current !== slug) {
      setPoints([]);
      setToday([]);
    }
    mountedSlug.current = slug;
    // No `{ summary: true }` here -- the home card only ever plots
    // typicals/today, so it deliberately skips the expensive summary-only
    // queries `/api/history` would otherwise run on every homepage load.
    getHistory(slug)
      .then((h) => {
        if (cancelled) return;
        const { weekdayClass, season } = denverNow();
        setPoints(typicalsToChartPoints(h.typicals, weekdayClass, season));
        setToday(todayToChartPoints(h.today));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [slug]);

  return (
    <a href="/history" className="bg-card border-card-border block rounded-2xl border p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-[15px] font-bold">When should you leave?</h2>
        <span className="text-muted text-[13px]">See full history →</span>
      </div>
      <p className="text-muted text-[12px]">{routeName}</p>
      <div className="mt-2 mb-1.5">
        <ChartLegend items={HOME_LEGEND} />
      </div>
      <TypicalChart points={points} today={today} compact />
    </a>
  );
}
