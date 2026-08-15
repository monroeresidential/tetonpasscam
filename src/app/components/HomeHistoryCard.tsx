import { useEffect, useRef, useState } from 'react';

import TypicalChart, { type ChartPoint } from './TypicalChart';
import { getHistory } from '../historyApi';

export default function HomeHistoryCard({ slug }: { slug: string }) {
  const [points, setPoints] = useState<ChartPoint[]>([]);
  const [today, setToday] = useState<{ hour: number; durationSec: number }[]>([]);
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
    getHistory(slug)
      .then((h) => {
        if (cancelled) return;
        const hourOf = (iso: string) =>
          Number(
            new Intl.DateTimeFormat('en-US', {
              timeZone: 'America/Denver',
              hour: 'numeric',
              hourCycle: 'h23',
            }).format(new Date(iso)),
          );
        setPoints(
          [...h.typicals]
            .sort((a, b) => a.hour - b.hour)
            .map((t) => ({
              hour: t.hour,
              medianSec: t.medianSec,
              p25Sec: t.p25Sec,
              p75Sec: t.p75Sec,
              distinctDays: t.distinctDays,
            })),
        );
        setToday(h.today.map((r) => ({ hour: hourOf(r.capturedAt), durationSec: r.durationSec })));
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
      <div className="mt-2">
        <TypicalChart points={points} today={today} compact />
      </div>
    </a>
  );
}
