import { useState } from 'react';

// Single-line nav (Drew-requested, replacing the earlier two-column layout):
// exactly these labels in this order, dot-separated, with the Feedback
// button appended as the last item. About.tsx's old trailing link row is
// gone too -- this is the page's one and only bottom nav (the byte-frozen
// crawler copy in index.html's #seo-shell keeps its own links).
const NAV_LINKS = [
  { href: '/privacy', label: 'Privacy policy' },
  { href: 'https://www.wyoroad.info', label: 'Wyoming 511' },
  { href: 'https://511.idaho.gov', label: 'Idaho 511' },
  { href: 'https://511notify.wyoroad.info', label: '511 Notify' },
  { href: '/embed', label: 'Embed Site' },
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
      {/* Same bottom-sheet card language as ReportModal (card 2d) -- rounded
          top corners + drag-handle bar -- so the two report/feedback sheets
          read as one system. Card 2e's mockup shows a "← Back" link instead
          (it's explored as a full navigated screen, not an overlay), but
          Footer's feedback entry point is a modal, so a "✕ Close" button is
          kept for consistency with ReportModal and existing behavior. */}
      <div className="bg-card w-full max-w-md rounded-t-2xl p-4 pb-5 sm:max-w-sm sm:rounded-2xl">
        <div className="bg-card-border mx-auto h-1 w-9 rounded-full" />

        <div className="mt-3.5 flex items-start justify-between gap-2">
          <div>
            <h2 className="font-display text-[24px] font-extrabold tracking-tight text-ink">
              Tell us what&apos;s broken (or what you&apos;d love)
            </h2>
            <p className="text-muted mt-0.5 text-[13px]">
              Goes straight to a human in Teton Valley.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-muted flex-none"
          >
            ✕
          </button>
        </div>

        {state === 'sent' ? (
          <p role="status" className="mt-3.5 text-sm">
            Thanks for the feedback!
          </p>
        ) : (
          <div className="mt-3.5 space-y-2.5">
            <div>
              <label htmlFor="feedback-body" className="sr-only">
                Feedback
              </label>
              <textarea
                id="feedback-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                maxLength={2000}
                rows={4}
                placeholder="Your message…"
                className="rounded-card border-card-border bg-card text-ink placeholder:text-faint w-full border p-3.5 text-[13.5px]"
              />
            </div>
            <div>
              <label htmlFor="feedback-email" className="sr-only">
                Email (optional)
              </label>
              <input
                id="feedback-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email (optional — only if you want a reply)"
                className="rounded-card border-card-border bg-card text-ink placeholder:text-faint w-full border p-3.5 text-[13.5px]"
              />
            </div>

            {state === 'error' && (
              <p className="text-sm font-semibold text-danger">
                Something went wrong. Try again.
              </p>
            )}

            <button
              type="button"
              onClick={submit}
              disabled={state === 'sending' || body.trim().length === 0}
              className="mt-1 h-12 w-full rounded-full bg-btn-bg font-display font-bold text-btn-ink disabled:opacity-50"
            >
              Send feedback
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Footer() {
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  return (
    <footer className="border-card-border text-muted border-t p-4 text-xs">
      <nav aria-label="Footer" className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
        {NAV_LINKS.map((link) => (
          <span key={link.href} className="flex items-center gap-x-2">
            <a href={link.href} className="underline">
              {link.label}
            </a>
            <span aria-hidden="true">·</span>
          </span>
        ))}
        <button
          type="button"
          onClick={() => setFeedbackOpen(true)}
          className="text-left underline"
        >
          Feedback
        </button>
      </nav>
      <p className="mt-2 text-center">Not affiliated with WYDOT.</p>

      {feedbackOpen && <FeedbackModal onClose={() => setFeedbackOpen(false)} />}
    </footer>
  );
}
