import { useEffect, useRef, useState } from 'react';

import Toast from './Toast';
import { buildShareUrl } from './ShareButton';

const TOAST_MS = 4000;

// navigator.share isn't universally declared across DOM lib versions/
// environments (and isn't present at all in jsdom), so it's accessed through
// a narrow local type rather than assuming lib.dom.d.ts already has it.
type NavigatorWithShare = Navigator & {
  share?: (data: { title?: string; url?: string }) => Promise<void>;
};

const PILL_CLASS =
  'flex-1 rounded-full bg-[#3a332a] py-3 text-center font-display text-[13px] font-bold text-stone-100';

export default function ShareSheet({
  shareCode,
  direction,
  onClose,
}: {
  shareCode: string;
  direction: 'eb' | 'wb';
  onClose: () => void;
}) {
  const [showToast, setShowToast] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const shareUrl = buildShareUrl(shareCode, direction);
  const nav = navigator as NavigatorWithShare;
  const canShare = typeof nav.share === 'function';

  // Escape closes regardless of what currently has focus (same reasoning as
  // Cameras.tsx's Lightbox -- no focus-trapping requirement here).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  // Move focus into the sheet on open; ShareButton's onClose returns focus
  // to the pill on the way back out.
  useEffect(() => {
    sheetRef.current?.focus();
  }, []);

  function flashToast() {
    setShowToast(true);
    setTimeout(() => setShowToast(false), TOAST_MS);
  }

  async function copyLink() {
    await navigator.clipboard.writeText(shareUrl);
    flashToast();
  }

  async function handleMore() {
    try {
      await nav.share!({ title: 'Teton Pass conditions', url: shareUrl });
    } catch (err) {
      // AbortError == the user dismissed the native share sheet -- a
      // deliberate cancel, not a failure, so it's a silent no-op. Any other
      // rejection falls back to the copy-link path (same behavior
      // ShareButton had before the sheet existed).
      if ((err as { name?: string } | null)?.name === 'AbortError') return;
      await copyLink();
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Share current conditions"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        ref={sheetRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="w-[min(92vw,560px)] rounded-[24px] bg-[#2b251d] p-5"
      >
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-stone-400 text-[11px] font-bold tracking-widest uppercase">
            Share current conditions
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-stone-400 flex-none"
          >
            ✕
          </button>
        </div>

        <div className="mt-3 aspect-[1200/630] w-full overflow-hidden bg-stone-800">
          <img
            src={`/og/${shareCode}-${direction}.png`}
            alt="Preview of the card recipients will see"
            className="h-full w-full object-cover"
          />
        </div>

        <div className="mt-4 flex gap-2">
          <button type="button" onClick={copyLink} className={PILL_CLASS}>
            Copy link
          </button>
          <a href={`sms:?&body=${encodeURIComponent(shareUrl)}`} className={PILL_CLASS}>
            Message
          </a>
          {canShare && (
            <button type="button" onClick={handleMore} className={PILL_CLASS}>
              More…
            </button>
          )}
        </div>
      </div>

      <Toast show={showToast}>Link copied</Toast>
    </div>
  );
}
