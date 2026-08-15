import type { HistorySummary } from '../../shared/types';

function minLabel(sec: number): string {
  return `${Math.round(sec / 60)} min`;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-card-border flex justify-between border-b py-1.5 last:border-b-0">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export default function SeasonCompare({
  seasonMedians,
  closureDays,
}: Pick<HistorySummary, 'seasonMedians' | 'closureDays'>) {
  const summer = seasonMedians?.summer ?? null;
  const winter = seasonMedians?.winter ?? null;
  const closures = closureDays?.winter ?? null;

  return (
    <div className="bg-card border-card-border rounded-2xl border p-5">
      <h2 className="font-display text-[15px] font-bold">Winter vs summer</h2>
      <div className="mt-2.5 text-[13px]">
        {summer !== null && <Row label="Median, summer" value={minLabel(summer)} />}
        {winter !== null && <Row label="Median, winter" value={minLabel(winter)} />}
        {/* Rendered only when known. A 0 here would assert we watched a full
            winter and saw no closures -- see closureDaysLastWinter. */}
        {closures !== null && <Row label="Closure days last winter (WYDOT)" value={String(closures)} />}
        {winter === null && (
          <p className="text-muted">Check back after the first snow — we need a winter to compare to.</p>
        )}
      </div>
    </div>
  );
}
