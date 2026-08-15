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
}

const VB_W = 940;
const VB_H = 260;
const PAD = { left: 40, right: 10, top: 20, bottom: 40 };

const DEFAULT_FORMAT = (v: number) => `${Math.round(v / 60)}m`;
const DEFAULT_ARIA_LABEL = 'Travel time by hour of day, today against the typical range';
/** How close the data must come to the reference before it is worth drawing.
 *  Beyond this the line would only stretch the domain into empty space. */
const REFERENCE_PROXIMITY = 8;

const NO_HISTORY = <p className="text-muted text-sm">No history for this route yet.</p>;

export default function TypicalChart({
  points,
  today,
  compact = false,
  formatValue = DEFAULT_FORMAT,
  secondary = [],
  referenceValue,
  ariaLabel = DEFAULT_ARIA_LABEL,
}: TypicalChartProps) {
  if (points.length === 0) return NO_HISTORY;

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
  if (dataValues.length === 0) return NO_HISTORY;

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

  return (
    <svg
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      className="block h-auto w-full"
      role="img"
      aria-label={ariaLabel}
    >
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
