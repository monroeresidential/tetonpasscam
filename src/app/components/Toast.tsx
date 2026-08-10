import type { ReactNode } from 'react';

/**
 * Minimal shared toast, extracted from ReportModal's original inline
 * `showToast` paragraph (share-cards T2). The original wasn't a component at
 * all -- just a JSX block gated by a boolean -- so this extraction is a
 * byte-identical lift of that markup/classNames into a one-off presentational
 * component, not a rewrite: ReportModal's pinned toast test
 * (`getByRole('status')` + text match) still passes unchanged, and
 * ShareButton reuses the same visual treatment for "Link copied" rather than
 * duplicating the className string.
 */
export default function Toast({ show, children }: { show: boolean; children: ReactNode }) {
  if (!show) return null;

  return (
    <p
      role="status"
      aria-live="polite"
      className="fixed bottom-20 inset-x-4 z-40 rounded bg-status-open px-4 py-2 text-center text-white sm:inset-x-auto sm:right-4"
    >
      {children}
    </p>
  );
}
