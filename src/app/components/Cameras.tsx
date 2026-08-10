import { useState } from 'react';

import { CAMERAS, type CameraDef } from '../cameras';
import type { CameraId } from '../../shared/types';

const WYOROAD_URL = 'https://www.wyoroad.info';
const SESSION_BEACON_PREFIX = 'camera-error-beaconed-';

/**
 * Device-local "h:mm AM" clock, same reasoning as Header.tsx's
 * `formatHeaderTime`: this is a friendly "when was this image last
 * refreshed" label derived from the client's own poll cadence
 * (`refreshedAt`/`mountTs` below), not a WYDOT-sourced timestamp -- so no
 * `timeZone: 'America/Denver'` pin (contrast StatusBanner/DriveTimes, which
 * do pin Denver because they format WYDOT report times).
 */
const TIME_FORMAT = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

function formatTimestamp(ts: number): string {
  return TIME_FORMAT.format(new Date(ts));
}

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

function CameraTile({
  cam,
  ts,
  hero,
  errored,
  onError,
}: {
  cam: CameraDef;
  ts: number;
  hero: boolean;
  errored: boolean;
  onError: () => void;
}) {
  const aspect = hero ? 'aspect-[16/8]' : 'aspect-video';

  return (
    <figure className={hero ? 'col-span-2' : ''}>
      {errored ? (
        <a
          href={WYOROAD_URL}
          className={`flex ${aspect} border-card-border bg-card w-full flex-col items-center justify-center gap-1 rounded-card border text-center text-sm underline`}
        >
          View on Wyoming 511
        </a>
      ) : (
        <img
          src={`${cam.url}?t=${ts}`}
          alt={cam.caption}
          loading="lazy"
          className={`${aspect} rounded-card w-full object-cover`}
          onError={onError}
        />
      )}
      <figcaption className="mt-1 flex items-baseline justify-between gap-2 text-sm">
        <span>
          <span>{cam.caption}</span> —{' '}
          <a href={WYOROAD_URL} className="underline">
            Wyoming 511
          </a>
        </span>
        <span className="text-muted shrink-0 text-[11px]">{formatTimestamp(ts)}</span>
      </figcaption>
    </figure>
  );
}

export default function Cameras({ refreshedAt = null }: { refreshedAt?: Date | null }) {
  const [errored, setErrored] = useState<Record<string, boolean>>({});
  // Cache-buster: tied to `useStatus`'s `refreshedAt` (App threads it
  // through), so the cams refresh on the same ~120s poll + visibilitychange
  // cadence as the rest of the Home screen, instead of freezing at
  // page-load for the tab's lifetime. `mountTs` is only a fallback for the
  // brief pre-first-load render (refreshedAt is null until useStatus's
  // first fetch resolves) and for callers that render Cameras standalone.
  const [mountTs] = useState(() => Date.now());
  const ts = refreshedAt ? refreshedAt.getTime() : mountTs;

  return (
    <section aria-label="Teton Pass cameras" className="p-4">
      <h2 className="font-display text-[15px] font-bold">Cameras</h2>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {CAMERAS.map((cam) => (
          <CameraTile
            key={cam.id}
            cam={cam}
            ts={ts}
            hero={cam.id === 'valley'}
            errored={Boolean(errored[cam.id])}
            onError={() => {
              setErrored((prev) => ({ ...prev, [cam.id]: true }));
              beaconCameraErrorOnce(cam.id);
            }}
          />
        ))}
      </div>
      <p className="text-faint mt-1 font-mono text-[10.5px]">Imagery: WYDOT Wyoming 511.</p>
    </section>
  );
}
