import { useEffect, useRef, useState } from 'react';

import type { AlertType } from '../../shared/types';
import { TYPE_ICON, TYPE_LABEL, TYPE_ORDER } from '../alertTypes';
import { getDeviceId } from '../deviceId';

const TYPE_OPTIONS = TYPE_ORDER.map((type) => ({
  type,
  icon: TYPE_ICON[type],
  label: TYPE_LABEL[type],
}));

type SubmitState = 'idle' | 'submitting' | 'rate-limited' | 'error';

const TOAST_MS = 4000;

export default function ReportModal({
  onSuccess,
  open,
  onOpenChange,
  renderTrigger = true,
}: {
  onSuccess?: () => void;
  /**
   * Trigger-placement refactor (Task 2): ReportModal now supports being
   * driven by an external open flag (`open`/`onOpenChange`, React's usual
   * controlled-component pair) in addition to its original fully-internal
   * state. When `open` is left `undefined` (every existing caller/test),
   * behavior is byte-identical to before -- internal state owns `isOpen`.
   * App.tsx uses the controlled form so Header's desktop button and this
   * component's own phone-only fixed pill can open the *same* modal
   * instance instead of App needing two ReportModal trees.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /**
   * Whether ReportModal renders its own "⚠ Report conditions" trigger
   * button. Defaults to true (unchanged standalone behavior, e.g.
   * ReportModal.test.tsx). App.tsx passes `false` on desktop, where
   * Header's own inline button is the trigger instead -- this is what
   * keeps exactly one such button in the DOM at a time (see Header.tsx's
   * comment on why two can't coexist under jsdom).
   */
  renderTrigger?: boolean;
} = {}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : internalOpen;
  // Task 8 restyle: card 2d's mockup shows the type grid, direction pills,
  // note field, and submit button all on ONE sheet at once (no
  // choose-type-then-details step-through like the pre-restyle modal) --
  // the "2-tap" flow is now literally two taps (a type tile, then Send
  // report), with direction/note as always-visible optional extras rather
  // than a second screen.
  const [type, setType] = useState<AlertType | null>(null);
  const [note, setNote] = useState('');
  const [direction, setDirection] = useState<'eb' | 'wb' | ''>('');
  const [submitState, setSubmitState] = useState<SubmitState>('idle');
  const [showToast, setShowToast] = useState(false);
  // Honeypot: a hidden field real users never see or fill in (Task 10's
  // POST /api/alerts treats any non-empty `website` as a bot and silently
  // discards the submission). Read via ref rather than React state -- a
  // controlled input a bot's autofill/script writes into still needs to
  // reach the request body untouched by us.
  const honeypotRef = useRef<HTMLInputElement>(null);

  function resetFlow() {
    setType(null);
    setNote('');
    setDirection('');
    setSubmitState('idle');
  }

  function setOpen(next: boolean) {
    if (!isControlled) setInternalOpen(next);
    onOpenChange?.(next);
  }

  // Reset the flow on every transition into "open" -- covers both the
  // internal trigger button below (openModal) and an external open (e.g.
  // Header's desktop button flipping App's lifted `reportOpen` state)
  // equally, since both ultimately just change `isOpen`.
  useEffect(() => {
    if (isOpen) resetFlow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  function openModal() {
    setOpen(true);
  }

  function closeModal() {
    setOpen(false);
  }

  async function submit() {
    if (!type) return;
    setSubmitState('submitting');
    try {
      const res = await fetch('/api/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          note: note.length > 0 ? note : null,
          direction: direction || null,
          deviceId: getDeviceId(),
          website: honeypotRef.current?.value ?? '',
        }),
      });

      if (res.status === 429) {
        setSubmitState('rate-limited');
        return;
      }
      if (!res.ok) {
        setSubmitState('error');
        return;
      }

      setOpen(false);
      setShowToast(true);
      setTimeout(() => setShowToast(false), TOAST_MS);
      // Pull the just-added report into the Home screen immediately rather
      // than waiting for useStatus's next scheduled poll (~120s) -- see
      // App.tsx, which wires this to useStatus's `refresh()`.
      onSuccess?.();
    } catch {
      setSubmitState('error');
    }
  }

  return (
    <>
      {renderTrigger && (
        <button
          type="button"
          onClick={openModal}
          className="fixed inset-x-4 bottom-4 z-40 min-h-12 rounded-full bg-btn-bg px-4 py-3 font-display font-bold text-btn-ink shadow-lg lg:hidden"
        >
          ⚠ Report conditions
        </button>
      )}

      {showToast && (
        <p
          role="status"
          aria-live="polite"
          className="fixed bottom-20 inset-x-4 z-40 rounded bg-green-700 px-4 py-2 text-center text-white sm:inset-x-auto sm:right-4"
        >
          Thanks — report submitted.
        </p>
      )}

      {isOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="What are you seeing?"
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center"
        >
          {/* Bottom sheet on phone (card 2d): fixed to the viewport bottom,
              rounded top corners, drag-handle bar. The mockup is phone-only
              -- desktop falls back to a centered dialog capped at max-w-sm
              (documented deviation; no desktop version of this card exists
              in the design handoff). */}
          <div className="bg-card w-full max-w-md rounded-t-2xl p-4 pb-5 sm:max-w-sm sm:rounded-2xl">
            <div className="bg-card-border mx-auto h-1 w-9 rounded-full" />

            <div className="mt-3.5 flex items-start justify-between gap-2">
              <div>
                <h2 className="font-display text-[22px] font-extrabold tracking-tight text-ink">
                  What are you seeing?
                </h2>
                <p className="text-muted mt-0.5 text-[12.5px]">
                  No account needed. Reports show as unverified and expire on their own.
                </p>
              </div>
              <button
                type="button"
                onClick={closeModal}
                aria-label="Close"
                className="text-muted flex-none"
              >
                ✕
              </button>
            </div>

            {/* Honeypot field: empty, off-screen, hidden from assistive
                tech, and never focusable via Tab -- real users never
                interact with it, so the POST body's `website` stays empty. */}
            <input
              ref={honeypotRef}
              type="text"
              name="website"
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
              defaultValue=""
              style={{
                position: 'absolute',
                left: '-9999px',
                width: '1px',
                height: '1px',
                opacity: 0,
                overflow: 'hidden',
              }}
            />

            <div className="mt-3.5 grid grid-cols-2 gap-2">
              {TYPE_OPTIONS.map((opt) => {
                const selected = type === opt.type;
                return (
                  <button
                    key={opt.type}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setType(opt.type)}
                    className={`rounded-card border-card-border flex items-center gap-2.5 border p-3.5 text-left ${
                      opt.type === 'other' ? 'col-span-2 justify-center text-center' : ''
                    } ${selected ? 'border-ink border-2' : ''}`}
                  >
                    <span className="text-lg">{opt.icon}</span> <span className="text-sm font-bold">{opt.label}</span>
                  </button>
                );
              })}
            </div>

            <div role="group" aria-label="Direction" className="mt-3.5 flex gap-2">
              {(['wb', 'eb'] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={direction === d}
                  onClick={() => setDirection(direction === d ? '' : d)}
                  className={`border-card-border text-muted flex-1 rounded-full border px-3 py-2.5 text-center text-[13px] font-bold aria-pressed:border-2 aria-pressed:border-ink aria-pressed:text-ink`}
                >
                  {d === 'wb' ? 'WB → Victor' : 'EB → Jackson'}
                </button>
              ))}
            </div>

            <div className="mt-3.5">
              <label htmlFor="report-note" className="sr-only">
                Note (optional)
              </label>
              <textarea
                id="report-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={140}
                rows={2}
                placeholder="Add a note (optional, 140 chars)…"
                className="rounded-card border-card-border bg-card text-ink placeholder:text-faint mt-1 w-full border p-3 text-[13.5px]"
              />
            </div>

            {submitState === 'rate-limited' && (
              <p className="mt-2.5 text-sm font-semibold text-red-600 dark:text-red-400">
                You&apos;re reporting too often
              </p>
            )}
            {submitState === 'error' && (
              <p className="mt-2.5 text-sm font-semibold text-red-600 dark:text-red-400">
                Something went wrong. Try again.
              </p>
            )}

            <button
              type="button"
              onClick={submit}
              disabled={!type || submitState === 'submitting'}
              className="mt-3.5 h-12 w-full rounded-full bg-btn-bg font-display font-bold text-btn-ink disabled:opacity-50"
            >
              Send report
            </button>

            <p className="text-faint mt-2.5 text-center text-[10.5px] leading-relaxed">
              This report does not change the official status — only WYDOT does. Limit 2 reports
              per 30 min.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
