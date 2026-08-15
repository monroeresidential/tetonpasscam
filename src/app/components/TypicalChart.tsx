import { bandRuns } from '../../shared/history';

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
   *  data already comes near it -- see REFERENCE_PROXIMITY below. */
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
}

const VB_W = 940;
const VB_H = 260;
const PAD = { left: 40, right: 10, top: 20, bottom: 40 };

const DEFAULT_FORMAT = (v: number) => `${Math.round(v / 60)}m`;
const DEFAULT_ARIA_LABEL = 'Travel time by hour of day, today against the typical range';
const DEFAULT_EMPTY_MESSAGE = 'No history for this route yet.';
/** How close the data must come to the reference before it is worth drawing.
 *  Beyond this the line would only stretch the domain into empty space. */
const REFERENCE_PROXIMITY = 8;

/** Font size for axis tick text, in viewBox units. Mock 2c used 10; this is
 *  deliberately larger. The viewBox is a fixed 940 units wide and scales to
 *  its container, so every `<text>` inside shrinks with it -- at a 390px
 *  phone, 10 units renders around 4px and is unreadable. 13 is a partial
 *  mitigation, not a fix; making axis text genuinely legible at phone width
 *  needs responsive font sizing or a different scaling strategy than one
 *  fixed viewBox, which is a larger change than adding the axes. */
const AXIS_FONT_SIZE = 13;

/** Hours between x-axis labels, matching mock 2c's cadence (4 AM, 7 AM, ...). */
const X_LABEL_STEP_HOURS = 3;

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
}: TypicalChartProps) {
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

  // The reference only joins the domain when the data already comes near it
  // -- otherwise a 45-79°F summer chart would be stretched down to 32°F.
  const dataMin = Math.min(...dataValues);
  const dataMax = Math.max(...dataValues);
  const showReference =
    referenceValue !== undefined &&
    referenceValue.value >= dataMin - REFERENCE_PROXIMITY &&
    referenceValue.value <= dataMax + REFERENCE_PROXIMITY;
  const values = showReference ? [...dataValues, referenceValue.value] : dataValues;

  const vMin = Math.min(...values);
  const vMax = Math.max(...values);
  // Explicit flat-series guard (vMax === vMin) rather than relying on the
  // `|| 1` idiom, which only works because 0 is falsy -- easy to break by
  // accident and worth spelling out given the NaN risk above.
  const span = vMax > vMin ? vMax - vMin : 1;
  const hSpan = hMax > hMin ? hMax - hMin : 1;

  const x = (hour: number) => PAD.left + ((hour - hMin) / hSpan) * (VB_W - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + (1 - (v - vMin) / span) * (VB_H - PAD.top - PAD.bottom);

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

  // Three y-ticks at the domain's min, midpoint and max, each rendered
  // through `formatValue` so the temperature chart's unit toggle relabels
  // them for free. Deliberately NOT a "nice round numbers" algorithm: mock
  // 2c's tidy 30m/45m/60m came from hand-drawn sample data, and min/mid/max
  // states the real domain without extra machinery to get wrong.
  const yTicks = compact ? [] : [vMin, vMin + span / 2, vMax];

  // X labels every three hours across the plotted range. Starts at the first
  // whole hour at or after hMin so a fractional domain edge can't produce a
  // label sitting outside the plot area.
  const xTicks: number[] = [];
  if (!compact) {
    for (let h = Math.ceil(hMin); h <= hMax; h += X_LABEL_STEP_HOURS) xTicks.push(h);
  }

  return (
    <svg
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      className="block h-auto w-full"
      role="img"
      aria-label={ariaLabel}
    >
      {/* Axis furniture first, so every series paints over it. Suppressed
          entirely in compact mode -- the home card is a teaser linking
          through to the full page, where axis text would be noise and, at
          that size, illegible. */}
      {!compact && (
        <>
          <line
            data-testid="axis-y"
            x1={PAD.left}
            y1={PAD.top}
            x2={PAD.left}
            y2={VB_H - PAD.bottom}
            stroke="var(--color-card-border)"
          />
          <line
            data-testid="axis-x"
            x1={PAD.left}
            y1={VB_H - PAD.bottom}
            x2={VB_W - PAD.right}
            y2={VB_H - PAD.bottom}
            stroke="var(--color-card-border)"
          />
          {yTicks.map((tick) => (
            <g key={`y-${tick}`}>
              <line
                x1={PAD.left}
                y1={y(tick)}
                x2={VB_W - PAD.right}
                y2={y(tick)}
                stroke="var(--color-card-border)"
                strokeOpacity="0.5"
              />
              <text
                x={PAD.left - 6}
                y={y(tick) + 4}
                textAnchor="end"
                fontSize={AXIS_FONT_SIZE}
                fill="var(--color-faint)"
              >
                {formatValue(tick)}
              </text>
            </g>
          ))}
          {xTicks.map((hour) => (
            <text
              key={`x-${hour}`}
              x={x(hour)}
              y={VB_H - PAD.bottom + AXIS_FONT_SIZE + 6}
              textAnchor="middle"
              fontSize={AXIS_FONT_SIZE}
              fill="var(--color-faint)"
            >
              {hourLabel(hour)}
            </text>
          ))}
        </>
      )}

      {showReference && referenceValue && (
        <>
          <line
            data-testid="reference-line"
            x1={PAD.left}
            y1={y(referenceValue.value)}
            x2={VB_W - PAD.right}
            y2={y(referenceValue.value)}
            stroke="var(--color-faint)"
            strokeWidth="1"
            strokeDasharray="5 4"
          />
          <text
            x={PAD.left + 4}
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
              y={y(last.value) - 14}
              textAnchor="middle"
              fontSize="11"
              fontWeight="700"
              fill="var(--color-accent)"
            >
              {`now · ${formatValue(last.value)}`}
            </text>
          )}
        </>
      )}
    </svg>
  );
}
