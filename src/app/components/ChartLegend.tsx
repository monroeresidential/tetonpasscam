/** How a series is drawn on the chart, so its swatch can look like it. */
export type LegendKind = 'line' | 'dashed' | 'band';

export interface LegendItem {
  label: string;
  kind: LegendKind;
  /** The SAME token the chart strokes/fills this series with -- pass
   *  `var(--color-…)`, never a literal. A legend entry that hardcodes a
   *  colour is one refactor away from describing a line it no longer
   *  matches, which is the failure this component exists to prevent. */
  color: string;
}

/** Alpha the chart fills its p25-p75 band at (TypicalChart's polygon uses
 *  fillOpacity 0.16). Mirrored here so the swatch reads as the same shade of
 *  wash rather than a solid block of the median's colour. */
const BAND_FILL_OPACITY = 0.16;

const SWATCH_BASE = 'inline-block shrink-0 rounded-[1px]';

function swatchStyle(item: LegendItem): React.CSSProperties {
  if (item.kind === 'band') {
    return { width: 18, height: 10, background: item.color, opacity: BAND_FILL_OPACITY * 3 };
  }
  if (item.kind === 'dashed') {
    // A 3px-tall repeating gradient reads as a dashed rule at this size,
    // matching the chart's strokeDasharray without needing an SVG.
    return {
      width: 18,
      height: 3,
      backgroundImage: `repeating-linear-gradient(to right, ${item.color} 0 4px, transparent 4px 7px)`,
    };
  }
  return { width: 18, height: 3, background: item.color };
}

/**
 * The shared legend for every chart on the site.
 *
 * Replaces the hand-written markup that used to sit at each call site,
 * where every series was described by a plain text glyph ("—", "▬") in one
 * muted colour regardless of the line it referred to -- so a reader could
 * not tell which entry belonged to which series, and the p25-p75 band was
 * labelled in statistics jargon. Two call sites had also already drifted:
 * one omitted two of its four series entirely.
 *
 * Each entry now renders the mark the chart actually draws, in that
 * series' own token colour.
 */
export default function ChartLegend({ items }: { items: LegendItem[] }) {
  return (
    <div className="text-muted flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px]">
      {items.map((item) => (
        <span key={item.label} className="inline-flex items-center gap-1.5">
          <span
            data-testid="legend-swatch"
            data-kind={item.kind}
            aria-hidden="true"
            className={SWATCH_BASE}
            style={swatchStyle(item)}
          />
          {item.label}
        </span>
      ))}
    </div>
  );
}
