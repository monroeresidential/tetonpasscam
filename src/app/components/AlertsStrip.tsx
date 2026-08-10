import type { PublicAlert } from '../../shared/types';
// Icon/label/direction-phrasing metadata is hoisted to a shared module
// (Task 8) so ReportModal's type grid can reuse the exact same
// emoji/label pairing instead of a second, driftable copy.
import { DIRECTION_SUFFIX, TYPE_ICON, TYPE_LABEL } from '../alertTypes';

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
    <li className="bg-card border-card-border rounded-card border px-3.5 py-3">
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
    <section aria-labelledby="alerts-heading" className="mt-4">
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
