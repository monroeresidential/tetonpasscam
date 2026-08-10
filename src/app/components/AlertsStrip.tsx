import type { AlertType, PublicAlert } from '../../shared/types';

const TYPE_ICON: Record<AlertType, string> = {
  crash: '💥',
  slideoff: '🛞',
  slick: '❄',
  wildlife: '🦌',
  stopped: '🚗',
  closure: '🚧',
  other: '⚠',
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

// Item-title direction phrasing: "toward" the side of the pass a driver
// coming from that direction is headed, not a bare compass word -- matches
// the Trailhead restyle's "From the road" card copy (task-5-brief.md).
const DIRECTION_SUFFIX: Record<'eb' | 'wb', string> = {
  wb: 'westbound to Victor',
  eb: 'eastbound to Jackson',
};

function titleFor(alert: PublicAlert): string {
  const label = TYPE_LABEL[alert.type];
  return alert.direction ? `${label} · ${DIRECTION_SUFFIX[alert.direction]}` : label;
}

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

function AlertCard({ alert, now }: { alert: PublicAlert; now: Date }) {
  return (
    <li className="bg-card border-card-border rounded-card border p-3">
      <div className="flex items-start gap-2.5">
        <div
          aria-hidden="true"
          className="bg-icon-tile flex h-8 w-8 flex-none items-center justify-center rounded-[10px] text-[15px]"
        >
          {TYPE_ICON[alert.type]}
        </div>
        <div className="flex-1">
          <div className="text-[13.5px] font-bold">{titleFor(alert)}</div>
          <p data-testid="alert-meta" className="text-muted mt-0.5 text-[12px]">
            {alert.note && (
              <>
                <span aria-hidden="true">&quot;</span>
                <span>{alert.note}</span>
                <span aria-hidden="true">&quot;</span>
                <span aria-hidden="true"> · </span>
              </>
            )}
            <span>{ageLabel(alert.createdAt, now)}</span>
          </p>
          <p className="text-faint mt-[3px] text-[10.5px]">Unverified community report</p>
        </div>
      </div>
    </li>
  );
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
      <h2 id="alerts-heading" className="font-display text-[15px] font-bold">
        From the road
      </h2>

      {/* CROSS-TASK FLAG (id33Advisory): a WYDOT-sourced advisory about the
          ID-33 Victor approach, unrelated to the WY-22 pass status itself --
          kept visually distinct here (muted card) and never folded into
          StatusBanner. */}
      {id33Advisory && (
        <p className="bg-card border-card-border text-muted rounded-card mt-2 border p-3 text-sm">
          <span className="text-ink font-semibold">ID-33 (Victor approach):</span> {id33Advisory}
        </p>
      )}

      {alerts.length === 0 ? (
        <p className="text-muted mt-2 text-sm">No reports in the last 3 hours.</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-2">
          {alerts.map((alert) => (
            <AlertCard key={alert.id} alert={alert} now={now} />
          ))}
        </ul>
      )}
    </section>
  );
}
