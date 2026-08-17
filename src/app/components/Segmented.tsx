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
  fullWidth = false,
}: {
  options: readonly [SegmentedOption<T>, SegmentedOption<T>];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  /** Fill the parent instead of hugging the labels, with the two segments
   *  splitting the space evenly. Opt-in because the default (content-width)
   *  is what /history's standalone control wants; the pair of controls on
   *  Home needs to share one row on a phone WITHOUT depending on their
   *  intrinsic widths happening to fit -- at larger text sizes they did not,
   *  and the second one wrapped onto its own line (see DriveTimes). */
  fullWidth?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={`bg-card border-card-border gap-[3px] rounded-full border p-[3px] ${
        fullWidth ? 'flex w-full' : 'inline-flex'
      }`}
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
            className={`min-h-[44px] rounded-full py-2 text-[12.5px] font-bold whitespace-nowrap ${
              // px-2 rather than px-4 when full width: the padding is only a
              // MINIMUM here since flex-1 expands each segment to fill its
              // half anyway, so the smaller floor buys headroom for larger
              // text without changing how the control looks at normal sizes.
              fullWidth ? 'flex-1 basis-0 px-2' : 'px-4'
            } ${active ? 'bg-btn-bg text-btn-ink' : 'text-muted'}`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
