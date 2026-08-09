import { describe, expect, it } from 'vitest';
import { fetchRouteTime, inPollingWindow } from '../../src/worker/poller/google-routes';
import { ROUTES } from '../../src/worker/db/seed-routes';

describe('fetchRouteTime', () => {
  it('maps computeRoutes response', async () => {
    const stub = async () =>
      new Response(
        JSON.stringify({
          routes: [{ duration: '1860s', staticDuration: '1800s', distanceMeters: 38000 }],
        }),
      );
    expect(await fetchRouteTime('k', ROUTES[0], stub)).toEqual({
      durationSec: 1860,
      staticDurationSec: 1800,
      distanceM: 38000,
    });
  });

  it('returns null on 4xx/5xx/timeout/malformed', async () => {
    expect(
      await fetchRouteTime('k', ROUTES[0], async () => new Response('nope', { status: 500 })),
    ).toBeNull();
    expect(
      await fetchRouteTime('k', ROUTES[0], async () => {
        throw new Error('timeout');
      }),
    ).toBeNull();
  });

  it('never puts the API key in the URL, only in the X-Goog-Api-Key header', async () => {
    let capturedUrl: string | undefined;
    let capturedHeaders: HeadersInit | undefined;
    const stub = async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = typeof input === 'string' ? input : input.toString();
      capturedHeaders = init?.headers;
      return new Response(
        JSON.stringify({
          routes: [{ duration: '1860s', staticDuration: '1800s', distanceMeters: 38000 }],
        }),
      );
    };
    await fetchRouteTime('SECRET_KEY', ROUTES[0], stub);
    expect(capturedUrl).not.toContain('SECRET_KEY');
    const headers = new Headers(capturedHeaders);
    expect(headers.get('X-Goog-Api-Key')).toBe('SECRET_KEY');
    expect(headers.get('X-Goog-FieldMask')).toBe(
      'routes.duration,routes.staticDuration,routes.distanceMeters',
    );
  });

  it('returns null when routes array is missing or empty', async () => {
    expect(
      await fetchRouteTime('k', ROUTES[0], async () => new Response(JSON.stringify({}))),
    ).toBeNull();
    expect(
      await fetchRouteTime('k', ROUTES[0], async () => new Response(JSON.stringify({ routes: [] }))),
    ).toBeNull();
  });

  it('returns null when duration fields are malformed (not NaN)', async () => {
    const stub = async () =>
      new Response(
        JSON.stringify({
          routes: [{ duration: 'abc', staticDuration: '1800s', distanceMeters: 38000 }],
        }),
      );
    expect(await fetchRouteTime('k', ROUTES[0], stub)).toBeNull();
  });
});

describe('inPollingWindow', () => {
  it('polling window is Denver-local', () => {
    expect(inPollingWindow(Date.UTC(2026, 0, 15, 10, 0))).toBe(false); // 03:00 MST
    expect(inPollingWindow(Date.UTC(2026, 0, 15, 15, 0))).toBe(true); // 08:00 MST
    expect(inPollingWindow(Date.UTC(2026, 6, 15, 6, 0))).toBe(false); // 00:00 MDT
  });

  it('exactly 05:00 Denver is true, exactly 23:00 Denver is false', () => {
    // Jan 2026 is MST (UTC-7): 05:00 MST == 12:00 UTC same day; 23:00 MST == 06:00 UTC next day
    expect(inPollingWindow(Date.UTC(2026, 0, 15, 12, 0))).toBe(true); // 05:00 MST
    expect(inPollingWindow(Date.UTC(2026, 0, 16, 6, 0))).toBe(false); // 23:00 MST (Jan 15)
  });

  it('04:59 Denver is false (just before window opens)', () => {
    // 04:59 MST == 11:59 UTC
    expect(inPollingWindow(Date.UTC(2026, 0, 15, 11, 59))).toBe(false);
  });
});
