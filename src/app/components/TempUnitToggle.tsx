import type { TempUnit } from '../units';

export default function TempUnitToggle({
  unit,
  onChange,
}: {
  unit: TempUnit;
  onChange: (u: TempUnit) => void;
}) {
  return (
    <div className="inline-flex items-center gap-1" role="group" aria-label="Temperature unit">
      {(['F', 'C'] as const).map((u) => (
        <button
          key={u}
          type="button"
          onClick={() => onChange(u)}
          aria-pressed={unit === u}
          className={
            unit === u
              ? 'bg-btn-bg text-btn-ink rounded-full px-2.5 py-1 text-[11px] font-bold'
              : 'text-muted rounded-full px-2.5 py-1 text-[11px]'
          }
        >
          °{u}
        </button>
      ))}
    </div>
  );
}
