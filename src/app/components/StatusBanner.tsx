import type { ApiStatus, PassStatus } from '../../shared/types';
import DetourBlock from './DetourBlock';

const TIME_FORMAT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Denver',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

function formatDenverTime(iso: string): string {
  return TIME_FORMAT.format(new Date(iso));
}

const STATUS_FILL: Record<PassStatus, string> = {
  open: 'bg-status-open',
  restricted: 'bg-status-restricted',
  closed: 'bg-status-closed',
  unknown: 'bg-status-unknown',
};

const HEADLINE_CLASS =
  'font-display text-[40px] font-extrabold leading-none tracking-tight lg:text-[46px]';

const CLOSED_LEGAL_COPY =
  'Closed — do not attempt. Traveling a closed Wyoming road is illegal (up to $750 fine).';

export default function StatusBanner({ data }: { data: ApiStatus }) {
  // CROSS-TASK SAFETY FLAG (Task 9 review, binding): pollerDead means the
  // API's status/conditionText/advisories/restrictions are last-known, not
  // current -- force the UNKNOWN presentation and never render those
  // fields as if they describe right now. They may only appear inside the
  // clearly-labeled last-confirmed line below.
  const effectiveStatus: PassStatus = data.pollerDead ? 'unknown' : data.status;
  const showCurrentDetail = !data.pollerDead;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`rounded-banner p-5 text-white ${STATUS_FILL[effectiveStatus]}`}
    >
      {effectiveStatus === 'open' && (
        <p data-testid="banner-headline" className={HEADLINE_CLASS}>
          The pass is OPEN
        </p>
      )}

      {effectiveStatus === 'restricted' && (
        <p data-testid="banner-headline" className={HEADLINE_CLASS}>
          RESTRICTED{data.restrictions.length > 0 ? ` — ${data.restrictions[0]}` : ''}
        </p>
      )}

      {effectiveStatus === 'closed' && (
        // The byte-frozen legal sentence below starts with these same
        // words. Splitting them across two <span>s keeps this headline's
        // own text from ever forming the contiguous "Closed — do not
        // attempt" substring in a single node -- otherwise the frozen
        // test's getByText(/Closed — do not attempt/) would match both
        // this headline and the legal sentence and throw for finding
        // multiple elements. Reads identically to a driver either way.
        <p data-testid="banner-headline" className={HEADLINE_CLASS}>
          <span>Closed —</span> <span>do not attempt</span>
        </p>
      )}

      {effectiveStatus === 'unknown' && (
        // Same reasoning as CLOSED above: the frozen pollerDead tests do
        // an exact getByText('UNKNOWN') match, so "UNKNOWN" needs to be
        // some element's own text on its own, separate from the " check
        // Wyoming 511" tail.
        <p data-testid="banner-headline" className={HEADLINE_CLASS}>
          <span>UNKNOWN</span> — check{' '}
          <a href="https://www.wyoroad.info" className="underline">
            Wyoming 511
          </a>
        </p>
      )}

      {effectiveStatus === 'closed' && (
        // The statutory warning is the banner's most important line in its
        // most important state -- keep it directly under the headline, at
        // full (not de-emphasized) size, ahead of the last-confirmed/
        // advisory meta below.
        <>
          <p className="mt-3 font-semibold">{CLOSED_LEGAL_COPY}</p>
          <DetourBlock detours={data.detours} />
        </>
      )}

      <div className="mt-2 text-[13px] opacity-90">
        {data.lastConfirmed ? (
          <p>
            Last confirmed {data.lastConfirmed.status} {formatDenverTime(data.lastConfirmed.at)} ·
            WYDOT
          </p>
        ) : (
          <p>No confirmed status available yet.</p>
        )}
      </div>

      {showCurrentDetail && data.advisories.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {data.advisories.map((advisory) => (
            <span
              key={advisory}
              className="inline-block rounded-full bg-white/18 px-3 py-1 text-xs"
            >
              Advisory: {advisory.toLowerCase()} (standing)
            </span>
          ))}
        </div>
      )}

      {data.isStale && (
        <p className="mt-3 inline-block rounded-full bg-status-restricted px-2 py-1 text-sm font-semibold text-ink">
          Data may be outdated — last WYDOT report{' '}
          {data.wydotReportTime ? formatDenverTime(data.wydotReportTime) : 'unavailable'}
        </p>
      )}
    </div>
  );
}
