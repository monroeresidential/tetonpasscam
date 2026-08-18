import { CLOSED_BANNER_WARNING } from '../../shared/legal';
import { effectivePassStatus } from '../effectiveStatus';
import type { ApiStatus, PassStatus } from '../../shared/types';
import DetourBlock from './DetourBlock';
import ShareButton from './ShareButton';

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

const SHARE_TONE: Record<PassStatus, string> = {
  open: 'text-status-open',
  restricted: 'text-status-restricted',
  closed: 'text-status-closed',
  unknown: 'text-status-unknown',
};

export default function StatusBanner({
  data,
  direction,
}: {
  data: ApiStatus;
  direction: 'eb' | 'wb';
}) {
  // CROSS-TASK SAFETY FLAG (Task 9 review, binding): pollerDead means the
  // API's status/conditionText/advisories/restrictions are last-known, not
  // current -- force the UNKNOWN presentation and never render those
  // fields as if they describe right now. They may only appear inside the
  // clearly-labeled last-confirmed line below.
  const effectiveStatus: PassStatus = effectivePassStatus(data);
  const showCurrentDetail = !data.pollerDead;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`rounded-banner p-5 text-white ${STATUS_FILL[effectiveStatus]}`}
    >
      <div className="flex items-start gap-3.5">
        <div className="flex-1">
          {effectiveStatus === 'open' && (
            <p data-testid="banner-headline" className={HEADLINE_CLASS}>
              OPEN
            </p>
          )}

          {effectiveStatus === 'restricted' && (
            <p data-testid="banner-headline" className={HEADLINE_CLASS}>
              RESTRICTED{data.restrictions.length > 0 ? ` — ${data.restrictions[0]}` : ''}
            </p>
          )}

          {effectiveStatus === 'closed' && (
            // One word, deliberately. "Closed — do not attempt" as a headline
            // wrapped across four lines of 40px type on a phone, with the em
            // dash orphaned at the start of line two, and then repeated itself
            // verbatim in the warning immediately below. The instruction moved
            // to that warning; this states the state.
            //
            // All four states are the bare status word in caps (Drew,
            // 2026-08-18) -- the same set the embed widget has always used.
            // Mixing "The pass is OPEN" with a one-word CLOSED read as an
            // oversight rather than a choice.
            <p data-testid="banner-headline" className={HEADLINE_CLASS}>
              CLOSED
            </p>
          )}

          {effectiveStatus === 'unknown' && (
            // Same reasoning as CLOSED above: the frozen pollerDead tests do
            // an exact getByText('UNKNOWN') match, so "UNKNOWN" needs to be
            // some element's own text on its own, separate from the " check
            // Wyoming 511" tail.
            <p data-testid="banner-headline" className={HEADLINE_CLASS}>
              <span>UNKNOWN</span> — check{' '}
              <a
                href="https://www.wyoroad.info/highway/conditions/RoadClosures.html"
                className="underline"
              >
                Wyoming 511
              </a>
            </p>
          )}
        </div>
        <ShareButton
          shareCode={data.pollerDead ? null : data.shareCode}
          direction={direction}
          toneClass={SHARE_TONE[effectiveStatus]}
        />
      </div>

      {effectiveStatus === 'closed' && (
        // The statutory warning is the banner's most important line in its
        // most important state -- keep it directly under the headline, at
        // full (not de-emphasized) size, ahead of the last-confirmed/
        // advisory meta below.
        <>
          <p className="mt-3 font-semibold">{CLOSED_BANNER_WARNING}</p>
          <DetourBlock detours={data.detours} />
        </>
      )}

      <div className="mt-2 text-[13px]">
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
