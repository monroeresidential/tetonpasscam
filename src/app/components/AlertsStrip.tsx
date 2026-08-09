import type { AlertType, PublicAlert } from '../../shared/types';

const TYPE_ICON: Record<AlertType, string> = {
  crash: '💥',
  slideoff: '🚙',
  slick: '🧊',
  wildlife: '🦌',
  stopped: '🚦',
  closure: '⛔',
  other: 'ℹ️',
};

const TYPE_LABEL: Record<AlertType, string> = {
  crash: 'Crash',
  slideoff: 'Slide-off',
  slick: 'Slick/Ice',
  wildlife: 'Wildlife',
  stopped: 'Stopped traffic',
  closure: 'Closure',
  other: 'Other',
};

const DIRECTION_LABEL: Record<'eb' | 'wb', string> = {
  eb: 'Eastbound',
  wb: 'Westbound',
};

/**
 * "N min ago" under an hour (rounded to the nearest minute); "N h ago" at or
 * after 60 minutes (rounded to the nearest hour) -- coarser precision is
 * fine once an alert is old enough that its exact type-based expiry (1-3h,
 * see Task 10's EXPIRY_HOURS) is the more relevant number anyway.
 */
function ageLabel(createdAt: string, now: Date): string {
  const diffMs = now.getTime() - new Date(createdAt).getTime();
  const minutes = Math.max(0, Math.round(diffMs / 60_000));
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return `${hours} h ago`;
}

export default function AlertsStrip({
  alerts,
  id33Advisory,
  now = new Date(),
}: {
  alerts: PublicAlert[];
  id33Advisory: string | null;
  now?: Date;
}) {
  return (
    <section aria-labelledby="alerts-heading" className="p-4">
      <h2 id="alerts-heading" className="text-lg font-bold">
        Community reports
      </h2>

      {/* CROSS-TASK FLAG (id33Advisory): a WYDOT-sourced advisory about the
          ID-33 Victor approach, unrelated to the WY-22 pass status itself --
          kept visually distinct here and never folded into StatusBanner. */}
      {id33Advisory && (
        <p className="mt-2 rounded border border-blue-300 bg-blue-50 p-2 text-sm text-blue-900 dark:border-blue-700 dark:bg-blue-950 dark:text-blue-200">
          <span className="font-semibold">ID-33 (Victor approach):</span> {id33Advisory}
        </p>
      )}

      {alerts.length === 0 ? (
        <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
          No reports in the last 3 hours.
        </p>
      ) : (
        <ul className="mt-2 space-y-2">
          {alerts.map((alert) => (
            <li
              key={alert.id}
              className="rounded border border-neutral-200 p-2 dark:border-neutral-700"
            >
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span aria-hidden="true">{TYPE_ICON[alert.type]}</span>
                <span className="font-medium">{TYPE_LABEL[alert.type]}</span>
                {alert.direction && (
                  <span className="text-sm text-neutral-600 dark:text-neutral-300">
                    {DIRECTION_LABEL[alert.direction]}
                  </span>
                )}
                <span className="text-sm text-neutral-500 dark:text-neutral-400">
                  {ageLabel(alert.createdAt, now)}
                </span>
              </div>
              {alert.note && <p className="mt-1 text-sm">{alert.note}</p>}
              <p className="mt-1 text-xs uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
                Unverified community report
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
