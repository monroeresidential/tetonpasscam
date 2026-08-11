import { useState } from 'react';

import Toast from './Toast';

const TOAST_MS = 4000;

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

// navigator.share isn't universally declared across DOM lib versions/
// environments (and isn't present at all in jsdom), so it's accessed through
// a narrow local type rather than assuming lib.dom.d.ts already has it.
type NavigatorWithShare = Navigator & {
  share?: (data: { title?: string; url?: string }) => Promise<void>;
};

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
  const [showToast, setShowToast] = useState(false);

  if (shareCode === null) return null;

  async function copyToClipboard(url: string) {
    await navigator.clipboard.writeText(url);
    setShowToast(true);
    setTimeout(() => setShowToast(false), TOAST_MS);
  }

  async function handleShare() {
    const url = buildShareUrl(shareCode as string, direction);
    const nav = navigator as NavigatorWithShare;

    if (typeof nav.share === 'function') {
      try {
        await nav.share({ title: 'Teton Pass conditions', url });
        return;
      } catch (err) {
        // AbortError == the user dismissed the native share sheet -- that's
        // a deliberate cancel, not a failure, so it's a silent no-op (no
        // toast, no clipboard fallback). Any other rejection (e.g. no share
        // target chosen, permission denied) falls through to clipboard below.
        if ((err as { name?: string } | null)?.name === 'AbortError') return;
      }
    }

    await copyToClipboard(url);
  }

  return (
    <>
      <button
        type="button"
        onClick={handleShare}
        aria-label="Share current conditions"
        className={`flex flex-none items-center gap-1.5 rounded-full bg-white px-4 py-2.5 font-display text-[13px] font-extrabold shadow-md ${toneClass}`}
      >
        <ShareIcon />
        Share
      </button>
      <Toast show={showToast}>Link copied</Toast>
    </>
  );
}
