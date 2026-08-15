import type { HistorySummary } from '../../shared/types';

function peakLabel(sec: number): string {
  return `${Math.round(sec / 60)} min peak`;
}

function dayLabel(isoDate: string): string {
  // isoDate is already a Denver-local 'YYYY-MM-DD' key from the API --
  // parse it as UTC noon so no local-timezone shift moves it a day.
  const d = new Date(`${isoDate}T12:00:00.000Z`);
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export default function WorstDays({ worstDays }: { worstDays: HistorySummary['worstDays'] }) {
  return (
    <div className="bg-card border-card-border rounded-2xl border p-5">
      <h2 className="font-display text-[15px] font-bold">Worst days this season</h2>
      {worstDays === null || worstDays.length === 0 ? (
        <p className="text-muted mt-2.5 text-[13px]">Not enough history yet.</p>
      ) : (
        <ul className="mt-2.5 text-[13px]">
          {worstDays.map((d) => (
            <li
              key={d.date}
              className="border-card-border flex justify-between border-b py-1.5 last:border-b-0"
            >
              <span>{dayLabel(d.date)}</span>
              <strong>{peakLabel(d.peakSec)}</strong>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
