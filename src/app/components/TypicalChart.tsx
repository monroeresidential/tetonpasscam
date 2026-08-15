import { bandRuns } from '../../shared/history';

export interface ChartPoint {
  hour: number;
  medianSec: number | null;
  p25Sec: number | null;
  p75Sec: number | null;
  distinctDays: number | null;
}

export interface TypicalChartProps {
  points: ChartPoint[];
  today: { hour: number; durationSec: number }[];
  compact?: boolean;
}

const VB_W = 940;
const VB_H = 260;
const PAD = { left: 40, right: 10, top: 20, bottom: 40 };

function minutes(sec: number): number {
  return Math.round(sec / 60);
}

export default function TypicalChart({ points, today, compact = false }: TypicalChartProps) {
  if (points.length === 0) return <p className="text-muted text-sm">No history for this route yet.</p>;

  const hours = points.map((p) => p.hour);
  const hMin = Math.min(...hours);
  const hMax = Math.max(...hours);

  // Y domain spans every value we actually draw -- band edges, medians, and
  // today's readings -- so nothing clips outside the plot area.
  const values = [
    ...points.flatMap((p) => [p.medianSec, p.p25Sec, p.p75Sec]),
    ...today.map((t) => t.durationSec),
  ].filter((v): v is number => v !== null);
  const vMin = Math.min(...values);
  const vMax = Math.max(...values);
  const span = vMax - vMin || 1;

  const x = (hour: number) =>
    PAD.left + ((hour - hMin) / (hMax - hMin || 1)) * (VB_W - PAD.left - PAD.right);
  const y = (sec: number) =>
    PAD.top + (1 - (sec - vMin) / span) * (VB_H - PAD.top - PAD.bottom);

  const medianPts = points
    .filter((p) => p.medianSec !== null)
    .map((p) => `${x(p.hour)},${y(p.medianSec as number)}`)
    .join(' ');

  const todayPts = today.map((t) => `${x(t.hour)},${y(t.durationSec)}`).join(' ');
  const last = today[today.length - 1];

  return (
    <svg
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      className="block h-auto w-full"
      role="img"
      aria-label="Travel time by hour of day, today against the typical range"
    >
      {/* Band first so the lines paint over it. One polygon per contiguous
          qualifying run -- bandRuns guarantees no polygon spans a thin or
          missing hour. */}
      {bandRuns(points).map((run) => {
        const top = run.map((p) => `${x(p.hour)},${y(p.p75Sec as number)}`);
        const bottom = [...run].reverse().map((p) => `${x(p.hour)},${y(p.p25Sec as number)}`);
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
            cy={y(last.durationSec)}
            r="5"
            fill="var(--color-accent)"
          />
          {!compact && (
            <text
              x={x(last.hour)}
              y={y(last.durationSec) - 14}
              textAnchor="middle"
              fontSize="11"
              fontWeight="700"
              fill="var(--color-accent)"
            >
              {`now · ${minutes(last.durationSec)}m`}
            </text>
          )}
        </>
      )}
    </svg>
  );
}
