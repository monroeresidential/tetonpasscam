export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

/**
 * Two-option pill toggle, used for the Idaho-town filter and the direction
 * switch on Home and the direction switch on /history. Extracted rather than
 * copied: three call sites with identical markup and different label pairs.
 *
 * Buttons with `aria-pressed` rather than radios: the visual is a pair of
 * pills, the behaviour is "pick one", and `aria-pressed` conveys that without
 * the label/fieldset scaffolding a radio group needs. `role="group"` carries
 * the pair's own name.
 *
 * Tokens map from the prototype: container `card`/`card-border`, active
 * segment `btn-bg`/`btn-ink`, inactive `muted` on no fill.
 */
export default function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: readonly [SegmentedOption<T>, SegmentedOption<T>];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="bg-card border-card-border inline-flex gap-[3px] rounded-full border p-[3px]"
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            // Re-clicking the active segment is a no-op rather than a
            // toggle: these are filters with no "neither" state.
            onClick={active ? undefined : () => onChange(option.value)}
            className={`min-h-[44px] rounded-full px-4 py-2 text-[12.5px] font-bold ${
              active ? 'bg-btn-bg text-btn-ink' : 'text-muted'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
