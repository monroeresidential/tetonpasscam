import { useState } from 'react';

import { CAMERAS } from '../cameras';
import type { CameraId } from '../../shared/types';

const WYOROAD_URL = 'https://www.wyoroad.info';
const SESSION_BEACON_PREFIX = 'camera-error-beaconed-';

/**
 * Sends the one-per-session-per-camera `/api/camera-error` beacon (Task
 * 10's `postCameraError` throttles per UTC day server-side; this
 * `sessionStorage` guard additionally keeps a single tab from firing the
 * beacon repeatedly if the same broken image re-triggers `onerror`, e.g. on
 * a retry or re-render). `sendBeacon` fires-and-forgets with no response to
 * await, matching the "beacon" semantics -- it survives the page unloading,
 * unlike a plain `fetch`.
 */
function beaconCameraErrorOnce(camera: CameraId): void {
  const key = `${SESSION_BEACON_PREFIX}${camera}`;
  try {
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');
  } catch {
    // Private browsing / disabled storage -- fall through and beacon anyway
    // rather than silently dropping the report; worst case is a duplicate
    // beacon within the same tab, which the server's per-day throttle still
    // caps at one email.
  }
  navigator.sendBeacon?.('/api/camera-error', JSON.stringify({ camera }));
}

export default function Cameras() {
  const [errored, setErrored] = useState<Record<string, boolean>>({});
  // Cache-buster computed once per mount (not per render) -- WYDOT's image
  // is refreshed periodically upstream; re-fetching on every React render
  // would just hammer the CDN mirror for no new frame.
  const [ts] = useState(() => Date.now());

  return (
    <section aria-label="Teton Pass cameras" className="p-4">
      <h2 className="text-lg font-bold">Cameras</h2>
      <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {CAMERAS.map((cam) => (
          <figure key={cam.id} className="rounded border border-neutral-200 p-2 dark:border-neutral-700">
            {errored[cam.id] ? (
              <a
                href={WYOROAD_URL}
                className="flex h-40 flex-col items-center justify-center gap-1 rounded bg-neutral-100 text-center text-sm underline dark:bg-neutral-800"
              >
                View on Wyoming 511
              </a>
            ) : (
              <img
                src={`${cam.url}?t=${ts}`}
                alt={cam.caption}
                loading="lazy"
                className="h-40 w-full rounded object-cover"
                onError={() => {
                  setErrored((prev) => ({ ...prev, [cam.id]: true }));
                  beaconCameraErrorOnce(cam.id);
                }}
              />
            )}
            <figcaption className="mt-1 text-sm">
              <span>{cam.caption}</span> —{' '}
              <a href={WYOROAD_URL} className="underline">
                Wyoming 511
              </a>
            </figcaption>
          </figure>
        ))}
      </div>
      <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">Imagery: WYDOT Wyoming 511.</p>
    </section>
  );
}
