import type { HistoryResult } from '../shared/types';

const FETCH_TIMEOUT_MS = 15_000;

/** Reads our own /api/history -- clients never call WYDOT or Google
 *  directly (CLAUDE.md). Mirrors api.ts's timeout guard.
 *
 *  `summary` defaults to OFF: the summary block (`worstDays`, `seasonMedians`,
 *  `closureDays`) drives a full `travel_times`-since-season-start scan on
 *  the worker (tens of thousands of rows by late season) that only the
 *  /history page's tables actually need. `HomeHistoryCard` only plots
 *  `typicals`/`today`, so it must NOT opt in. */
export async function getHistory(slug: string, opts: { summary?: boolean } = {}): Promise<HistoryResult> {
  const query = new URLSearchParams({ route: slug });
  if (opts.summary) query.set('summary', '1');
  const res = await fetch(`/api/history?${query.toString()}`, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`GET /api/history failed with ${res.status}`);
  return (await res.json()) as HistoryResult;
}
