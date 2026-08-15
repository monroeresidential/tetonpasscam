import type { WeatherHistoryResult } from '../shared/types';

const FETCH_TIMEOUT_MS = 15_000;

/** Reads our own /api/weather-history. Mirrors historyApi.ts's timeout guard. */
export async function getWeatherHistory(): Promise<WeatherHistoryResult> {
  const res = await fetch('/api/weather-history', {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`GET /api/weather-history failed with ${res.status}`);
  return (await res.json()) as WeatherHistoryResult;
}
