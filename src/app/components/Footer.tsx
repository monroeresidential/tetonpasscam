import { useState } from 'react';

const LINKS = [
  { href: 'https://www.wyoroad.info', label: 'Wyoming 511' },
  { href: 'https://511.idaho.gov', label: 'Idaho 511' },
  { href: 'https://www.startbus.com', label: 'START bus' },
  { href: 'https://511notify.wyoroad.info', label: '511 Notify (get text/email alerts)' },
  { href: '/privacy.html', label: 'Privacy policy' },
];

type SendState = 'idle' | 'sending' | 'sent' | 'error';

function FeedbackModal({ onClose }: { onClose: () => void }) {
  const [body, setBody] = useState('');
  const [email, setEmail] = useState('');
  const [state, setState] = useState<SendState>('idle');

  async function submit() {
    if (body.trim().length === 0) return;
    setState('sending');
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body, email: email.length > 0 ? email : null }),
      });
      if (!res.ok) {
        setState('error');
        return;
      }
      setState('sent');
      setTimeout(onClose, 1500);
    } catch {
      setState('error');
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Send feedback"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center"
    >
      <div className="w-full max-w-md rounded-lg bg-white p-4 dark:bg-neutral-800">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">Send feedback</h2>
          <button type="button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {state === 'sent' ? (
          <p role="status" className="mt-3 text-sm">
            Thanks for the feedback!
          </p>
        ) : (
          <div className="mt-3 space-y-3">
            <div>
              <label htmlFor="feedback-body" className="block text-sm font-medium">
                Feedback
              </label>
              <textarea
                id="feedback-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                maxLength={2000}
                rows={4}
                className="mt-1 w-full rounded border border-neutral-300 p-2 dark:border-neutral-600 dark:bg-neutral-900"
              />
            </div>
            <div>
              <label htmlFor="feedback-email" className="block text-sm font-medium">
                Email (optional)
              </label>
              <input
                id="feedback-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded border border-neutral-300 p-2 dark:border-neutral-600 dark:bg-neutral-900"
              />
            </div>

            {state === 'error' && (
              <p className="text-sm font-semibold text-red-600 dark:text-red-400">
                Something went wrong. Try again.
              </p>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={submit}
                disabled={state === 'sending' || body.trim().length === 0}
                className="rounded bg-neutral-800 px-4 py-2 font-semibold text-white disabled:opacity-50 dark:bg-neutral-200 dark:text-black"
              >
                Send
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Footer() {
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  return (
    <footer className="border-t border-neutral-200 p-4 text-sm text-neutral-600 dark:border-neutral-700 dark:text-neutral-400">
      <nav aria-label="Footer" className="flex flex-wrap gap-x-4 gap-y-2">
        {LINKS.map((link) => (
          <a key={link.href} href={link.href} className="underline">
            {link.label}
          </a>
        ))}
        <button type="button" onClick={() => setFeedbackOpen(true)} className="underline">
          Feedback
        </button>
      </nav>
      <p className="mt-2">Not affiliated with WYDOT.</p>

      {feedbackOpen && <FeedbackModal onClose={() => setFeedbackOpen(false)} />}
    </footer>
  );
}
