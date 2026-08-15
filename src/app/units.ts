import { useCallback, useState } from 'react';

const STORAGE_KEY = 'temp-unit';

export type TempUnit = 'F' | 'C';

/** Exact conversion. Temperatures are STORED in Fahrenheit only -- WYDOT
 *  reports whole degrees F and its own parenthesized Celsius is a rounded
 *  conversion of an already-rounded number, so deriving C here is strictly
 *  more accurate than persisting theirs. */
export function fToC(f: number): number {
  return ((f - 32) * 5) / 9;
}

export function formatTemp(f: number, unit: TempUnit): string {
  return unit === 'C' ? `${Math.round(fToC(f))}°C` : `${Math.round(f)}°F`;
}

function readStored(): TempUnit {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'C' ? 'C' : 'F';
  } catch {
    return 'F';
  }
}

/**
 * The site-wide temperature unit preference. Defaults to Fahrenheit for a
 * Wyoming/Idaho audience. Persisted in `localStorage` behind the same
 * try/catch `deviceId.ts` uses -- private browsing, disabled storage, and
 * quota errors all degrade to "this session uses the default" rather than
 * crashing a page over a display preference.
 */
export function useTempUnit(): { unit: TempUnit; setUnit: (u: TempUnit) => void } {
  const [unit, setUnitState] = useState<TempUnit>(readStored);

  const setUnit = useCallback((u: TempUnit) => {
    setUnitState(u);
    try {
      localStorage.setItem(STORAGE_KEY, u);
    } catch {
      // Preference simply won't survive this session. Not worth surfacing.
    }
  }, []);

  return { unit, setUnit };
}
