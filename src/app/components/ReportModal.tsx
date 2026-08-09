import { useRef, useState } from 'react';

import type { AlertType } from '../../shared/types';
import { getDeviceId } from '../deviceId';

const TYPE_OPTIONS: { type: AlertType; label: string }[] = [
  { type: 'crash', label: 'Crash' },
  { type: 'slideoff', label: 'Slide-off' },
  { type: 'slick', label: 'Slick/Ice' },
  { type: 'wildlife', label: 'Wildlife' },
  { type: 'stopped', label: 'Stopped traffic' },
  { type: 'closure', label: 'Closure' },
  { type: 'other', label: 'Other' },
];

type Step = 'type' | 'details';
type SubmitState = 'idle' | 'submitting' | 'rate-limited' | 'error';

const TOAST_MS = 4000;

export default function ReportModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [step, setStep] = useState<Step>('type');
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
    setStep('type');
    setType(null);
    setNote('');
    setDirection('');
    setSubmitState('idle');
  }

  function openModal() {
    resetFlow();
    setIsOpen(true);
  }

  function closeModal() {
    setIsOpen(false);
  }

  function chooseType(t: AlertType) {
    setType(t);
    setStep('details');
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

      setIsOpen(false);
      setShowToast(true);
      setTimeout(() => setShowToast(false), TOAST_MS);
    } catch {
      setSubmitState('error');
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className="fixed bottom-4 inset-x-4 z-40 rounded-full bg-red-600 px-4 py-3 font-semibold text-white shadow-lg sm:inset-x-auto sm:right-4 sm:w-auto"
      >
        ⚠ Report conditions
      </button>

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
          aria-label="Report conditions"
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center"
        >
          <div className="w-full max-w-md rounded-lg bg-white p-4 dark:bg-neutral-800">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">Report conditions</h2>
              <button type="button" onClick={closeModal} aria-label="Close">
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

            {step === 'type' && (
              <div className="mt-3 grid grid-cols-2 gap-2">
                {TYPE_OPTIONS.map((opt) => (
                  <button
                    key={opt.type}
                    type="button"
                    onClick={() => chooseType(opt.type)}
                    className="rounded border border-neutral-300 p-3 text-left font-medium dark:border-neutral-600"
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}

            {step === 'details' && type && (
              <div className="mt-3 space-y-3">
                <p className="text-sm text-neutral-500 dark:text-neutral-400">
                  Reporting: {TYPE_OPTIONS.find((o) => o.type === type)?.label}
                </p>

                <div>
                  <label htmlFor="report-note" className="block text-sm font-medium">
                    Note (optional)
                  </label>
                  <textarea
                    id="report-note"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    maxLength={140}
                    rows={3}
                    className="mt-1 w-full rounded border border-neutral-300 p-2 dark:border-neutral-600 dark:bg-neutral-900"
                  />
                </div>

                <div role="group" aria-label="Direction" className="flex gap-2">
                  {(['eb', 'wb'] as const).map((d) => (
                    <button
                      key={d}
                      type="button"
                      aria-pressed={direction === d}
                      onClick={() => setDirection(direction === d ? '' : d)}
                      className="rounded border border-neutral-300 px-3 py-1 text-sm aria-pressed:bg-neutral-800 aria-pressed:text-white dark:border-neutral-600 dark:aria-pressed:bg-neutral-200 dark:aria-pressed:text-black"
                    >
                      {d === 'eb' ? 'Eastbound' : 'Westbound'}
                    </button>
                  ))}
                </div>

                {submitState === 'rate-limited' && (
                  <p className="text-sm font-semibold text-red-600 dark:text-red-400">
                    You&apos;re reporting too often
                  </p>
                )}
                {submitState === 'error' && (
                  <p className="text-sm font-semibold text-red-600 dark:text-red-400">
                    Something went wrong. Try again.
                  </p>
                )}

                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setStep('type')}
                    className="text-sm underline"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={submit}
                    disabled={submitState === 'submitting'}
                    className="rounded bg-red-600 px-4 py-2 font-semibold text-white disabled:opacity-50"
                  >
                    Submit
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
