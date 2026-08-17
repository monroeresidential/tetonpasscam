import { bandRuns } from '../../shared/history';
import { useIsDesktop } from '../useIsDesktop';

export interface ChartPoint {
  hour: number;
  median: number | null;
  p25: number | null;
  p75: number | null;
  distinctDays: number | null;
}

export interface TypicalChartProps {
  points: ChartPoint[];
  today: { hour: number; value: number }[];
  compact?: boolean;
  formatValue?: (v: number) => string;
  /** Median line only, no band of its own -- e.g. a second series plotted
   *  alongside the primary for comparison (surface vs. air temperature). */
  secondary?: ChartPoint[];
  /** A dashed horizontal line (e.g. freezing) drawn only when the plotted
   *  data actually CROSSES it -- i.e. the value falls inside the data's own
   *  range. A reference the data never reaches is withheld rather than
   *  stretching the chart down to meet it; see the containment check in the
   *  body for why this is a containment test and not a proximity window. */
  referenceValue?: { value: number; label: string };
  /** Accessible name for the chart's SVG. Defaults to the original
   *  travel-time wording so existing (drive-time) callers are unaffected --
   *  any non-travel-time chart (e.g. temperature) MUST override this, or a
   *  screen-reader user is told they're hearing drive times when they're not. */
  ariaLabel?: string;
  /** Message shown in place of the chart when there is nothing to plot.
   *  Defaults to the original travel-time wording so existing (drive-time)
   *  callers are unaffected -- any non-route chart (e.g. a station-wide
   *  temperature chart) MUST override this, or a "for this route" message
   *  is shown for data that has no route at all. */
  emptyMessage?: string;
  /** Axis title below the x-axis tick labels. Defaults to the shared
   *  time-of-day wording, since every chart on this component plots against
   *  the same 24-hour Denver-local axis regardless of what's on the y-axis. */
  xAxisTitle?: string;
  /** Axis title beside the y-axis, rotated -90deg. Defaults to the original
   *  travel-time wording so existing (drive-time) callers are unaffected --
   *  any non-travel-time chart (e.g. temperature) MUST override this. */
  yAxisTitle?: string;
}

interface ChartProfile {
  w: number;
  h: number;
  padL: number;
  padR: number;
  padT: number;
  padB: number;
  tickFont: number;
  xTickHours: number;
}

/**
 * Two complete geometry profiles rather than one scaled viewBox. The old
 * single 940x260 box scaled to any container, so 13-unit tick text rendered
 * around 5px at phone width -- the root cause this replaces, and the one the
 * file's previous comment declined to take on.
 *
 * Switched on a real 1024px media query (the `useIsDesktop` pattern from
 * App.tsx), not on CSS, because the tick COUNT changes too and that is a
 * render decision, not a style.
 */
const CHART_PROFILE: { desktop: ChartProfile; phone: ChartProfile } = {
  desktop: { w: 900, h: 236, padL: 60, padR: 10, padT: 14, padB: 46, tickFont: 13, xTickHours: 3 },
  phone: { w: 360, h: 216, padL: 50, padR: 10, padT: 14, padB: 42, tickFont: 11, xTickHours: 4 },
};

const DEFAULT_FORMAT = (v: number) => `${Math.round(v / 60)}m`;
const DEFAULT_ARIA_LABEL = 'Travel time by hour of day, today against the typical range';
const DEFAULT_EMPTY_MESSAGE = 'No history for this route yet.';
const DEFAULT_X_AXIS_TITLE = 'Time of day (MT)';
const DEFAULT_Y_AXIS_TITLE = 'Travel time (min)';

/** Size, weight and tracking for both axis titles. Fixed regardless of
 *  profile -- unlike tick text, the titles are short, fixed strings, so
 *  there's no phone-width truncation risk to size down for. */
const AXIS_TITLE_FONT_SIZE = 11;
const AXIS_TITLE_STYLE: React.CSSProperties = { letterSpacing: '0.04em' };

/** Roughly half the width of the widest now-label ("now · 100°F"), in
 *  viewBox units. Estimated rather than measured: SVG text has no width
 *  until it is in a DOM, the label's content is bounded and short, and
 *  over-reserving here costs nothing -- the anchor simply flips a little
 *  earlier than strictly necessary. */
const NOW_LABEL_HALF_WIDTH = 45;

/**
 * Which end of the now-label to anchor to, given its x position.
 *
 * The label is centred on its dot, so a reading at either edge of the plot
 * ran past the viewBox and was clipped -- the drive-time chart rendered
 * "now · 3" instead of "now · 37m" whenever the latest reading was the
 * rightmost point, which is the normal case for a chart of today so far.
 * Anchoring to the near end makes the text grow inward instead.
 *
 * Takes the active profile because the plot's right/left edges (VB width and
 * padding) now vary between the desktop and phone geometries.
 */
function nowLabelAnchor(px: number, profile: ChartProfile): 'start' | 'middle' | 'end' {
  if (px + NOW_LABEL_HALF_WIDTH > profile.w - profile.padR) return 'end';
  if (px - NOW_LABEL_HALF_WIDTH < profile.padL) return 'start';
  return 'middle';
}

const NOW_LABEL_FONT_SIZE = 11;
/** Gap between the dot and its label, in viewBox units. */
const NOW_LABEL_OFFSET = 14;
/** Width of the card-coloured halo knocked out behind the now-label. Painted
 *  as a stroke UNDER the fill (paint-order), so the text punches a gap
 *  through whatever sits behind it -- the today line, the median, a
 *  gridline, or the band edge. The label and the today line share
 *  --color-accent, so an overlap is same-colour-on-same-colour and the halo
 *  is what keeps it readable; slope-aware placement below only reduces how
 *  often the overlap happens at all. */
const NOW_LABEL_HALO_WIDTH = 4;

/**
 * Baseline y for the now-label, given its dot and whether today's line is
 * rising into that dot.
 *
 * A rising line approaches the dot from BELOW, leaving the space above it
 * clear -- so the label goes above. A falling line comes from higher on
 * screen, and that is exactly where a fixed above-the-dot label used to
 * land: on the live temperature chart "now · 46°F" sat directly on the
 * trace. Falling therefore puts the label below instead.
 *
 * Clamped into the plot area so a reading at either extreme cannot push its
 * label out of frame. At the very edges the label may still sit near the
 * dot; the halo is what keeps it legible there.
 *
 * Takes the active profile because the plot's top/bottom clamp (VB height
 * and padding) now varies between the desktop and phone geometries.
 */
function nowLabelY(dotY: number, rising: boolean, profile: ChartProfile): number {
  const raw = rising
    ? dotY - NOW_LABEL_OFFSET
    : dotY + NOW_LABEL_OFFSET + NOW_LABEL_FONT_SIZE * 0.8;
  const top = profile.padT + NOW_LABEL_FONT_SIZE;
  const bottom = profile.h - profile.padB;
  return Math.min(Math.max(raw, top), bottom);
}

/** 24-hour clock value -> the mock's 12-hour label ("13" -> "1 PM"). */
function hourLabel(hour: number): string {
  const h = Math.round(hour) % 24;
  const suffix = h < 12 ? 'AM' : 'PM';
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display} ${suffix}`;
}

export default function TypicalChart({
  points,
  today,
  compact = false,
  formatValue = DEFAULT_FORMAT,
  secondary = [],
  referenceValue,
  ariaLabel = DEFAULT_ARIA_LABEL,
  emptyMessage = DEFAULT_EMPTY_MESSAGE,
  xAxisTitle = DEFAULT_X_AXIS_TITLE,
  yAxisTitle = DEFAULT_Y_AXIS_TITLE,
}: TypicalChartProps) {
  // Read before any early return -- Rules of Hooks -- even though the empty
  // states below never reach the JSX that uses it.
  const isDesktop = useIsDesktop();
  const profile = isDesktop ? CHART_PROFILE.desktop : CHART_PROFILE.phone;

  const noHistory = <p className="text-muted text-sm">{emptyMessage}</p>;

  if (points.length === 0) return noHistory;

  // X domain spans every hour we actually draw -- points, secondary, AND
  // today's readings -- so a today reading outside the points' hour range
  // never gets silently clipped by the SVG viewport.
  const hours = [
    ...points.map((p) => p.hour),
    ...secondary.map((p) => p.hour),
    ...today.map((t) => t.hour),
  ];
  const hMin = Math.min(...hours);
  const hMax = Math.max(...hours);

  // Y domain spans every value we actually draw -- band edges, medians,
  // secondary series, and today's readings -- so nothing clips outside the
  // plot area. Surface temp runs 15-20F above air in summer and inverts in
  // winter, so a domain computed from the primary series alone would
  // silently clip the secondary.
  const dataValues = [
    ...points.flatMap((p) => [p.median, p.p25, p.p75]),
    ...secondary.flatMap((p) => [p.median, p.p25, p.p75]),
    ...today.map((t) => t.value),
  ].filter((v): v is number => v !== null);

  // Nothing plottable (every value null and no today readings) -- bail out
  // the same honest way as the empty-points case rather than risk a
  // degenerate domain. Math.min/max of an empty array is +/-Infinity, and
  // `(-Infinity) || 1` does NOT fall back to 1 (-Infinity is truthy), so
  // without this guard every y() below would compute NaN.
  if (dataValues.length === 0) return noHistory;

  // The reference is drawn only when the plotted data actually crosses it.
  //
  // This was originally an absolute proximity window ("within 8 of the
  // domain"), which stopped meaning anything once this component became
  // unit-agnostic: 8 against a drive-time domain measured in SECONDS
  // (~900 units wide) is 0.9% and never fires, while 8 against a
  // temperature domain in DEGREES (~61 units wide) is 13% and fires almost
  // always. A percentage would fix that inconsistency but still leaves an
  // arbitrary number to tune -- so the window is gone entirely.
  //
  // Containment is unit-neutral by construction, and it makes the
  // domain-stretching problem disappear: a reference inside the range is
  // already within the domain, so nothing is stretched and no empty band
  // opens up below the data. The rule states plainly -- the freezing line
  // appears when it is freezing. In August, when nothing plotted is under
  // 44°F, it stays hidden and the axis's own minimum tick conveys the
  // distance from freezing perfectly well.
  const dataMin = Math.min(...dataValues);
  const dataMax = Math.max(...dataValues);
  const showReference =
    referenceValue !== undefined &&
    referenceValue.value >= dataMin &&
    referenceValue.value <= dataMax;
  // Kept for symmetry with the pre-containment behavior; a contained
  // reference cannot widen the domain, so this is a no-op by construction.
  const values = showReference ? [...dataValues, referenceValue.value] : dataValues;

  const vMin = Math.min(...values);
  const vMax = Math.max(...values);
  // Explicit flat-series guard (vMax === vMin) rather than relying on the
  // `|| 1` idiom, which only works because 0 is falsy -- easy to break by
  // accident and worth spelling out given the NaN risk above.
  const span = vMax > vMin ? vMax - vMin : 1;
  const hSpan = hMax > hMin ? hMax - hMin : 1;

  const x = (hour: number) =>
    profile.padL + ((hour - hMin) / hSpan) * (profile.w - profile.padL - profile.padR);
  const y = (v: number) =>
    profile.padT + (1 - (v - vMin) / span) * (profile.h - profile.padT - profile.padB);

  const medianPts = points
    .filter((p) => p.median !== null)
    .map((p) => `${x(p.hour)},${y(p.median as number)}`)
    .join(' ');

  const secondaryPts = secondary
    .filter((p) => p.median !== null)
    .map((p) => `${x(p.hour)},${y(p.median as number)}`)
    .join(' ');

  const todayPts = today.map((t) => `${x(t.hour)},${y(t.value)}`).join(' ');
  const last = today[today.length - 1];
  // Is today's line rising into its final point? Decides which side of the
  // dot the label sits on -- see nowLabelY. A single reading has no slope to
  // read, so it defaults to the historical above-the-dot placement.
  const prevToday = today.length >= 2 ? today[today.length - 2] : null;
  const nowLabelRising = prevToday === null || last.value >= prevToday.value;

  // Three y-ticks at the domain's min, midpoint and max, each rendered
  // through `formatValue` so the temperature chart's unit toggle relabels
  // them for free. Deliberately NOT a "nice round numbers" algorithm: mock
  // 2c's tidy 30m/45m/60m came from hand-drawn sample data, and min/mid/max
  // states the real domain without extra machinery to get wrong.
  const yTicks = [vMin, vMin + span / 2, vMax];

  // X labels every profile.xTickHours across the plotted range (3h desktop,
  // 4h phone -- phone gets fewer, wider-spaced labels because its viewBox is
  // narrower). Starts at the first whole hour at or after hMin so a
  // fractional domain edge can't produce a label sitting outside the plot
  // area.
  const xTicks: number[] = [];
  for (let h = Math.ceil(hMin); h <= hMax; h += profile.xTickHours) xTicks.push(h);

  return (
    <svg
      viewBox={`0 0 ${profile.w} ${profile.h}`}
      className="block h-auto w-full"
      role="img"
      aria-label={ariaLabel}
    >
      {/* Axis furniture first, so every series paints over it. Rendered on
          BOTH surfaces, compact included. Compact originally suppressed all
          of this on the theory that the home card is only a teaser linking
          through to the full page -- but rendered, that produced a bare
          line with no scale, where a reader could not tell thirty minutes
          from ninety. `compact` now governs only the now-label text, which
          is the one genuinely dense element. */}
      <>
          <line
            data-testid="axis-y"
            x1={profile.padL}
            y1={profile.padT}
            x2={profile.padL}
            y2={profile.h - profile.padB}
            stroke="var(--color-card-border)"
          />
          <line
            data-testid="axis-x"
            x1={profile.padL}
            y1={profile.h - profile.padB}
            x2={profile.w - profile.padR}
            y2={profile.h - profile.padB}
            stroke="var(--color-card-border)"
          />
          {yTicks.map((tick) => (
            <g key={`y-${tick}`}>
              <line
                x1={profile.padL}
                y1={y(tick)}
                x2={profile.w - profile.padR}
                y2={y(tick)}
                stroke="var(--color-card-border)"
                strokeOpacity="0.5"
              />
              <text
                x={profile.padL - 6}
                y={y(tick) + 4}
                textAnchor="end"
                fontSize={profile.tickFont}
                fill="var(--color-faint)"
              >
                {formatValue(tick)}
              </text>
            </g>
          ))}
          {xTicks.map((hour) => (
            <text
              key={`x-${hour}`}
              data-testid="x-tick"
              x={x(hour)}
              y={profile.h - profile.padB + profile.tickFont + 6}
              textAnchor="middle"
              fontSize={profile.tickFont}
              fill="var(--color-faint)"
            >
              {hourLabel(hour)}
            </text>
          ))}
          {/* Axis titles. X is centred below the tick labels; Y is rotated
              -90deg and anchored near the left edge (x=12), roughly centred
              on the plot's vertical span. Fixed size regardless of profile --
              see AXIS_TITLE_FONT_SIZE. */}
          <text
            data-testid="x-axis-title"
            x={profile.padL + (profile.w - profile.padL - profile.padR) / 2}
            y={profile.h - 4}
            textAnchor="middle"
            fontSize={AXIS_TITLE_FONT_SIZE}
            fontWeight="700"
            fill="var(--color-faint)"
            style={AXIS_TITLE_STYLE}
          >
            {xAxisTitle}
          </text>
          <text
            data-testid="y-axis-title"
            x={12}
            y={profile.padT + (profile.h - profile.padT - profile.padB) / 2}
            textAnchor="middle"
            fontSize={AXIS_TITLE_FONT_SIZE}
            fontWeight="700"
            fill="var(--color-faint)"
            style={AXIS_TITLE_STYLE}
            transform={`rotate(-90 12 ${profile.padT + (profile.h - profile.padT - profile.padB) / 2})`}
          >
            {yAxisTitle}
          </text>
      </>

      {showReference && referenceValue && (
        <>
          <line
            data-testid="reference-line"
            x1={profile.padL}
            y1={y(referenceValue.value)}
            x2={profile.w - profile.padR}
            y2={y(referenceValue.value)}
            stroke="var(--color-faint)"
            strokeWidth="1"
            strokeDasharray="5 4"
          />
          <text
            x={profile.padL + 4}
            y={y(referenceValue.value) - 4}
            fontSize="10"
            fill="var(--color-faint)"
          >
            {referenceValue.label}
          </text>
        </>
      )}

      {/* Band first so the lines paint over it. One polygon per contiguous
          qualifying run -- bandRuns guarantees no polygon spans a thin or
          missing hour. */}
      {bandRuns(points).map((run) => {
        const top = run.map((p) => `${x(p.hour)},${y(p.p75 as number)}`);
        const bottom = [...run].reverse().map((p) => `${x(p.hour)},${y(p.p25 as number)}`);
        return (
          <polygon
            key={`band-${run[0].hour}`}
            data-testid="band"
            points={[...top, ...bottom].join(' ')}
            fill="var(--color-status-open)"
            fillOpacity="0.16"
          />
        );
      })}

      {medianPts && (
        <polyline
          data-testid="median"
          points={medianPts}
          fill="none"
          stroke="var(--color-status-open)"
          strokeWidth="2"
        />
      )}

      {secondaryPts && (
        <polyline
          data-testid="median-secondary"
          points={secondaryPts}
          fill="none"
          stroke="var(--color-muted)"
          strokeWidth="2"
          strokeDasharray="4 3"
        />
      )}

      {todayPts && (
        <polyline
          data-testid="today"
          points={todayPts}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth="3"
          strokeLinecap="round"
        />
      )}

      {last && (
        <>
          <circle
            data-testid="now-dot"
            cx={x(last.hour)}
            cy={y(last.value)}
            r="5"
            fill="var(--color-accent)"
          />
          {!compact && (
            <text
              x={x(last.hour)}
              y={nowLabelY(y(last.value), nowLabelRising, profile)}
              textAnchor={nowLabelAnchor(x(last.hour), profile)}
              fontSize={NOW_LABEL_FONT_SIZE}
              fontWeight="700"
              fill="var(--color-accent)"
              stroke="var(--color-card)"
              strokeWidth={NOW_LABEL_HALO_WIDTH}
              paintOrder="stroke"
            >
              {`now · ${formatValue(last.value)}`}
            </text>
          )}
        </>
      )}
    </svg>
  );
}
