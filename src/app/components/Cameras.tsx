import { useEffect, useRef, useState } from 'react';

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
  onOpen,
}: {
  cam: CameraDef;
  ts: number;
  hero: boolean;
  errored: boolean;
  onError: () => void;
  onOpen: () => void;
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
        <button
          type="button"
          onClick={onOpen}
          aria-label={`View ${cam.caption} full size`}
          className="block w-full"
        >
          <img
            src={`${cam.url}?t=${ts}`}
            alt={cam.caption}
            loading="lazy"
            className={`${aspect} rounded-card w-full object-cover`}
            onError={onError}
          />
        </button>
      )}
      <figcaption className="mt-1 flex items-baseline justify-between gap-2 text-sm">
        <span>{cam.caption}</span>
        <span className="text-muted shrink-0 text-[11px]">{formatTimestamp(ts)}</span>
      </figcaption>
    </figure>
  );
}

function Lightbox({
  cams,
  index,
  ts,
  onClose,
  onPrev,
  onNext,
}: {
  cams: CameraDef[];
  index: number;
  ts: number;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  // Keyboard nav: Escape closes, arrows cycle. Attached to `document` (not
  // the dialog node) so it fires regardless of what currently has focus --
  // there's no focus-trapping requirement here, just global key handling
  // while the overlay is mounted.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') onPrev();
      else if (e.key === 'ArrowRight') onNext();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose, onPrev, onNext]);

  // Lock body scroll while the overlay is open; restore whatever inline
  // value was there before (usually '') on unmount/close.
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  const cam = cams[index];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={cam.caption}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        aria-label="Close"
        className="absolute top-4 right-4 text-3xl text-white"
      >
        ×
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onPrev();
        }}
        aria-label="Previous camera"
        className="absolute left-2 text-4xl text-white sm:left-4"
      >
        ‹
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onNext();
        }}
        aria-label="Next camera"
        className="absolute right-2 text-4xl text-white sm:right-4"
      >
        ›
      </button>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-w-full flex-col items-center gap-2"
      >
        <img
          src={`${cam.url}?t=${ts}`}
          alt={cam.caption}
          className="max-h-[90vh] max-w-[95vw] rounded-card object-contain"
        />
        <div className="text-center text-white">
          <p>{cam.caption}</p>
          <p className="text-[11px] opacity-80">{formatTimestamp(ts)}</p>
        </div>
      </div>
    </div>
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
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  // A single WYDOT image blip shouldn't kill a camera for the rest of the
  // tab's life: every time `ts` advances (a new poll cycle's cache-buster),
  // give errored tiles a fresh chance by clearing the map, so the <img> for
  // that camera re-renders and retries. Skips the very first run (ts hasn't
  // "advanced" yet, nothing is errored, and this would just be a same-value
  // set) via a ref rather than depending on `errored` itself, which would
  // otherwise re-trigger this effect on every onError.
  const prevTs = useRef(ts);
  useEffect(() => {
    if (prevTs.current !== ts) {
      prevTs.current = ts;
      setErrored({});
    }
  }, [ts]);

  return (
    <section aria-label="Teton Pass cameras" className="mt-4">
      <h2 className="font-display text-[15px] font-bold">Cameras</h2>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {CAMERAS.map((cam, i) => (
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
            onOpen={() => setLightboxIndex(i)}
          />
        ))}
      </div>
      <p className="text-faint mt-1 font-mono text-[10.5px]">Imagery: WYDOT Wyoming 511.</p>

      {lightboxIndex !== null && (
        <Lightbox
          cams={CAMERAS}
          index={lightboxIndex}
          ts={ts}
          onClose={() => setLightboxIndex(null)}
          onPrev={() =>
            setLightboxIndex((i) => (i === null ? null : (i - 1 + CAMERAS.length) % CAMERAS.length))
          }
          onNext={() =>
            setLightboxIndex((i) => (i === null ? null : (i + 1) % CAMERAS.length))
          }
        />
      )}
    </section>
  );
}
