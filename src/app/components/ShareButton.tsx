import { useRef, useState } from 'react';

import ShareSheet from './ShareSheet';

/**
 * `window.location.origin` (not a hardcoded production constant) -- this
 * makes the built URL correct in dev (`localhost:5173`/`wrangler dev`), in
 * prod (`tetonpasscam.com`), and on any future host the app is served from,
 * since the `/s/{code}` route is served by whatever Worker answers this
 * origin's requests (see T1's `src/worker/index.ts` wiring) rather than
 * being tied to one specific domain. `code` is the datetime share code
 * (`YYYYMMDD-HHmm`, America/Denver) `ApiStatus.shareCode` returns -- see
 * `src/worker/share-code.ts`.
 */
export function buildShareUrl(code: string, direction: 'eb' | 'wb'): string {
  const base = `${window.location.origin}/s/${code}`;
  return direction === 'wb' ? `${base}?dir=wb` : base;
}

function ShareIcon() {
  return (
    <svg
      width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.6" y1="10.6" x2="15.4" y2="6.4" />
      <line x1="8.6" y1="13.4" x2="15.4" y2="17.6" />
    </svg>
  );
}

export default function ShareButton({
  shareCode,
  direction,
  toneClass = 'text-ink',
}: {
  // Withheld entirely (not just disabled) when null -- see ApiStatus.shareCode's
  // doc comment: pollerDead/no-snapshot means there is nothing current to share.
  shareCode: string | null;
  direction: 'eb' | 'wb';
  toneClass?: string;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  if (shareCode === null) return null;

  function closeSheet() {
    setSheetOpen(false);
    // Return focus to the pill that opened the sheet (matches the "on
    // close, return focus to the Share pill" requirement) -- ShareSheet
    // itself has no reference to this button, so the pill's own onClose
    // handler is where that restoration has to happen.
    buttonRef.current?.focus();
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setSheetOpen(true)}
        aria-label="Share current conditions"
        className={`flex flex-none items-center gap-1.5 rounded-full bg-white px-4 py-2.5 font-display text-[13px] font-extrabold shadow-md ${toneClass}`}
      >
        <ShareIcon />
        Share
      </button>
      {sheetOpen && (
        <ShareSheet shareCode={shareCode} direction={direction} onClose={closeSheet} />
      )}
    </>
  );
}
