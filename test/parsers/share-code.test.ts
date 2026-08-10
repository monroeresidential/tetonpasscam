import { describe, expect, it } from 'vitest';

import {
  formatShareCode,
  isValidShareCodeFormat,
  shareCodeToUtcWindow,
} from '../../src/worker/share-code';

describe('isValidShareCodeFormat', () => {
  it('accepts exactly 8 digits, a hyphen, 4 digits', () => {
    expect(isValidShareCodeFormat('20260810-1412')).toBe(true);
  });

  it.each([
    '53', // old numeric snapshot id
    '2026081-1412', // 7 digits
    '20260810-141', // 3-digit minute
    '20260810-14122', // 5-digit minute
    '20260810_1412', // wrong separator
    "20260810-1412'; DROP TABLE status_snapshots;--",
    '',
    ' 20260810-1412',
    '20260810-1412 ',
  ])('rejects %s', (code) => {
    expect(isValidShareCodeFormat(code)).toBe(false);
  });
});

describe('formatShareCode / shareCodeToUtcWindow roundtrip', () => {
  it('roundtrips a normal (non-DST-boundary) instant', () => {
    // 2026-08-10 12:00 MDT (GMT-6, summer) == 18:00 UTC.
    const capturedAt = '2026-08-10T18:00:00.000Z';
    const code = formatShareCode(capturedAt);
    expect(code).toBe('20260810-1200');

    const window = shareCodeToUtcWindow(code);
    expect(window).not.toBeNull();
    const capturedMs = Date.parse(capturedAt);
    expect(capturedMs).toBeGreaterThanOrEqual(window!.start);
    expect(capturedMs).toBeLessThan(window!.end);
    expect(window!.end - window!.start).toBe(60_000);
  });

  it('roundtrips a winter (MST) instant', () => {
    // 2026-01-14 07:00 MST (GMT-7, winter) == 14:00 UTC.
    const capturedAt = '2026-01-14T14:00:00.000Z';
    const code = formatShareCode(capturedAt);
    expect(code).toBe('20260114-0700');

    const window = shareCodeToUtcWindow(code);
    const capturedMs = Date.parse(capturedAt);
    expect(capturedMs).toBeGreaterThanOrEqual(window!.start);
    expect(capturedMs).toBeLessThan(window!.end);
  });

  it('BEFORE the spring-forward jump on a DST transition day, the primary window is still correct', () => {
    // 2026-03-08 01:00 MST (still GMT-7, the 02:00 jump hasn't happened yet)
    // == 08:00 UTC -- same-day midnight is also still MST, so the
    // constant-offset guess holds.
    const capturedAt = '2026-03-08T08:00:00.000Z';
    const code = formatShareCode(capturedAt);
    expect(code).toBe('20260308-0100');

    const window = shareCodeToUtcWindow(code);
    const capturedMs = Date.parse(capturedAt);
    expect(capturedMs).toBeGreaterThanOrEqual(window!.start);
    expect(capturedMs).toBeLessThan(window!.end);
  });

  it('AFTER the spring-forward jump on a DST transition day, the primary window drifts by the DST delta (fallback territory)', () => {
    // 2026-03-08 03:15 MDT (GMT-6, after the 02:00->03:00 jump) == 09:15 UTC.
    // The primary window assumes the whole day is at the SAME offset as
    // midnight (still MST/-7 there), so it computes 00:00 MST + 3h15m ==
    // 10:15 UTC -- exactly 1h later than the true instant. This is the
    // scenario card/data.ts's resolveShareCode falls back for.
    const capturedAt = '2026-03-08T09:15:00.000Z';
    const code = formatShareCode(capturedAt);
    expect(code).toBe('20260308-0315');

    const window = shareCodeToUtcWindow(code);
    const capturedMs = Date.parse(capturedAt);
    // Deliberately NOT in the primary window -- this is the documented drift.
    expect(capturedMs < window!.start || capturedMs >= window!.end).toBe(true);
    expect(window!.start - capturedMs).toBe(3_600_000);
  });

  it('returns null for a malformed code', () => {
    expect(shareCodeToUtcWindow('not-a-code')).toBeNull();
    expect(shareCodeToUtcWindow('53')).toBeNull();
  });
});
