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

const STATUS_LABEL: Record<PassStatus, string> = {
  open: 'OPEN',
  restricted: 'RESTRICTED',
  closed: 'CLOSED',
  unknown: 'UNKNOWN',
};

const STATUS_STYLES: Record<PassStatus, string> = {
  open: 'bg-green-600 dark:bg-green-700 text-white',
  restricted: 'bg-amber-500 dark:bg-amber-600 text-black dark:text-white',
  closed: 'bg-red-600 dark:bg-red-700 text-white',
  unknown: 'bg-gray-500 dark:bg-gray-600 text-white',
};

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
      className={`w-full p-6 ${STATUS_STYLES[effectiveStatus]}`}
    >
      <p className="text-5xl font-black tracking-tight">{STATUS_LABEL[effectiveStatus]}</p>

      {effectiveStatus === 'restricted' && data.restrictions.length > 0 && (
        <p className="mt-1 text-xl font-semibold">{data.restrictions.join(', ')}</p>
      )}

      {effectiveStatus === 'closed' && (
        <>
          <p className="mt-2 font-semibold">{CLOSED_LEGAL_COPY}</p>
          <DetourBlock detours={data.detours} />
        </>
      )}

      {effectiveStatus === 'unknown' && (
        <p className="mt-1 text-xl">
          Check{' '}
          <a href="https://www.wyoroad.info" className="underline font-semibold">
            Wyoming 511
          </a>
        </p>
      )}

      {showCurrentDetail && data.conditionText && (
        <p className="mt-2 text-sm opacity-90">{data.conditionText}</p>
      )}
      {showCurrentDetail && data.advisories.length > 0 && (
        <ul className="mt-1 text-sm opacity-90 list-disc list-inside">
          {data.advisories.map((advisory) => (
            <li key={advisory}>{advisory}</li>
          ))}
        </ul>
      )}

      {data.isStale && (
        <p className="mt-3 inline-block rounded bg-amber-500 px-2 py-1 text-sm font-semibold text-black">
          Data may be outdated — last WYDOT report{' '}
          {data.wydotReportTime ? formatDenverTime(data.wydotReportTime) : 'unavailable'}
        </p>
      )}

      <div className="mt-3 text-sm opacity-90 space-y-0.5">
        <p>
          Last WYDOT report:{' '}
          {data.wydotReportTime ? formatDenverTime(data.wydotReportTime) : 'unavailable'}
        </p>
        {data.lastConfirmed ? (
          <p>
            Last confirmed {data.lastConfirmed.status} at {formatDenverTime(data.lastConfirmed.at)}
          </p>
        ) : (
          <p>No confirmed status available yet.</p>
        )}
      </div>
    </div>
  );
}
