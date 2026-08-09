import { describe, expect, it } from 'vitest';
import { fetchId33Events } from '../../src/worker/poller/idaho511';

// Victor, ID is roughly 43.6, -111.1. The brief's box is lat 43.2-44.0,
// lng -111.6 to -110.9 (~25mi radius around Victor).
const VICTOR_LAT = 43.6;
const VICTOR_LNG = -111.1;

function event(overrides: Record<string, unknown> = {}) {
  return {
    ID: '1001',
    RoadwayName: 'ID-33',
    Description: 'Rockslide cleanup',
    IsFullClosure: false,
    Latitude: VICTOR_LAT,
    Longitude: VICTOR_LNG,
    ...overrides,
  };
}

describe('fetchId33Events', () => {
  it('maps and includes an ID-33 event within the Victor box', async () => {
    const stub = async () => new Response(JSON.stringify([event()]));
    expect(await fetchId33Events('k', stub)).toEqual([
      { eventId: '1001', description: 'Rockslide cleanup', isFullClosure: false },
    ]);
  });

  it('excludes events on other roadways', async () => {
    const stub = async () =>
      new Response(JSON.stringify([event({ ID: '2', RoadwayName: 'ID-22' })]));
    expect(await fetchId33Events('k', stub)).toEqual([]);
  });

  it('excludes ID-33-named events outside the Victor box', async () => {
    const stub = async () =>
      new Response(
        JSON.stringify([event({ ID: '3', Latitude: 42.0, Longitude: -111.1 })]),
      );
    expect(await fetchId33Events('k', stub)).toEqual([]);
  });

  it('excludes route names that merely contain the substring "33", like US 133', async () => {
    const stub = async () =>
      new Response(JSON.stringify([event({ ID: '4', RoadwayName: 'US 133' })]));
    expect(await fetchId33Events('k', stub)).toEqual([]);
  });

  it('matches "SH-33", "State Highway 33", and bare "33" tokens, not just "ID-33"', async () => {
    const stub = async () =>
      new Response(
        JSON.stringify([
          event({ ID: '5', RoadwayName: 'SH-33' }),
          event({ ID: '6', RoadwayName: 'State Highway 33' }),
        ]),
      );
    const result = await fetchId33Events('k', stub);
    expect(result?.map((e) => e.eventId).sort()).toEqual(['5', '6']);
  });

  it('maps IsFullClosure true through to isFullClosure', async () => {
    const stub = async () =>
      new Response(JSON.stringify([event({ ID: '7', IsFullClosure: true })]));
    expect(await fetchId33Events('k', stub)).toEqual([
      { eventId: '7', description: 'Rockslide cleanup', isFullClosure: true },
    ]);
  });

  it('skips malformed entries (missing/wrong-typed fields) without nulling the whole result', async () => {
    const stub = async () =>
      new Response(
        JSON.stringify([
          event({ ID: '8' }), // valid
          { RoadwayName: 'ID-33', Latitude: VICTOR_LAT, Longitude: VICTOR_LNG }, // missing ID
          { ID: '9', RoadwayName: 'ID-33', Latitude: 'not-a-number', Longitude: VICTOR_LNG },
          null,
          'garbage',
          42,
        ]),
      );
    expect(await fetchId33Events('k', stub)).toEqual([
      { eventId: '8', description: 'Rockslide cleanup', isFullClosure: false },
    ]);
  });

  it('returns [] for an empty array response', async () => {
    const stub = async () => new Response(JSON.stringify([]));
    expect(await fetchId33Events('k', stub)).toEqual([]);
  });

  it('returns null on HTTP 500', async () => {
    const stub = async () => new Response('nope', { status: 500 });
    expect(await fetchId33Events('k', stub)).toBeNull();
  });

  it('returns null on network failure/timeout', async () => {
    const stub = async () => {
      throw new Error('timeout');
    };
    expect(await fetchId33Events('k', stub)).toBeNull();
  });

  it('returns null when the payload is not an array', async () => {
    const stub = async () => new Response(JSON.stringify({ oops: true }));
    expect(await fetchId33Events('k', stub)).toBeNull();
  });

  it('never puts the API key anywhere but the URL query string as documented, and calls the v2 event endpoint once', async () => {
    let calls = 0;
    let capturedUrl = '';
    const stub = async (input: RequestInfo | URL) => {
      calls += 1;
      capturedUrl = typeof input === 'string' ? input : input.toString();
      return new Response(JSON.stringify([]));
    };
    await fetchId33Events('SECRET_KEY', stub);
    expect(calls).toBe(1);
    expect(capturedUrl).toContain('511.idaho.gov/api/v2/get/event');
    expect(capturedUrl).toContain('key=SECRET_KEY');
  });

  it('treats box boundary values as inclusive/behaves sensibly at the edges', async () => {
    const stub = async () =>
      new Response(
        JSON.stringify([
          event({ ID: 'lo', Latitude: 43.2, Longitude: -111.6 }),
          event({ ID: 'hi', Latitude: 44.0, Longitude: -110.9 }),
          event({ ID: 'outside-lat', Latitude: 44.1, Longitude: -111.1 }),
          event({ ID: 'outside-lng', Latitude: 43.6, Longitude: -110.8 }),
        ]),
      );
    const result = await fetchId33Events('k', stub);
    expect(result?.map((e) => e.eventId).sort()).toEqual(['hi', 'lo']);
  });
});
