import type { HistoryResult } from '../shared/types';

const FETCH_TIMEOUT_MS = 15_000;

/** Reads our own /api/history -- clients never call WYDOT or Google
 *  directly (CLAUDE.md). Mirrors api.ts's timeout guard. */
export async function getHistory(slug: string): Promise<HistoryResult> {
  const res = await fetch(`/api/history?route=${encodeURIComponent(slug)}`, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`GET /api/history failed with ${res.status}`);
  return (await res.json()) as HistoryResult;
}
