import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import TypicalChart, { type ChartPoint } from '../../src/app/components/TypicalChart';
import { MIN_DISTINCT_DAYS_FOR_BAND } from '../../src/shared/history';

const OK = MIN_DISTINCT_DAYS_FOR_BAND;

function pt(hour: number, median: number): ChartPoint {
  return { hour, median, p25: median - 5, p75: median + 5, distinctDays: OK };
}

describe('TypicalChart — generalized', () => {
  it('formats the now-label with formatValue instead of minutes', () => {
    render(
      <TypicalChart
        points={[pt(6, 50), pt(7, 52)]}
        today={[{ hour: 6.5, value: 51 }]}
        formatValue={(v) => `${Math.round(v)}°F`}
      />,
    );
    expect(screen.getByText(/now · 51°F/)).toBeTruthy();
  });

  it('defaults to minute formatting when no formatValue is given', () => {
    render(
      <TypicalChart points={[pt(6, 2280), pt(7, 2280)]} today={[{ hour: 6.5, value: 2280 }]} />,
    );
    expect(screen.getByText(/now · 38m/)).toBeTruthy();
  });

  it('draws a secondary median line with no band of its own', () => {
    render(
      <TypicalChart
        points={[pt(6, 50), pt(7, 52)]}
        secondary={[pt(6, 70), pt(7, 72)]}
        today={[]}
      />,
    );
    expect(screen.getByTestId('median-secondary')).toBeTruthy();
    // One band only -- the primary's. The secondary is a bare line.
    expect(screen.getAllByTestId('band')).toHaveLength(1);
  });

  it('includes the secondary series in the y-domain so it cannot be clipped', () => {
    // Surface temp runs well above air in summer. If the domain came from
    // the primary alone, the secondary would render outside the plot area.
    const { container } = render(
      <TypicalChart points={[pt(6, 50), pt(7, 50)]} secondary={[pt(6, 90), pt(7, 90)]} today={[]} />,
    );
    const secondary = screen.getByTestId('median-secondary');
    const ys = (secondary.getAttribute('points') ?? '')
      .split(' ')
      .map((p) => Number(p.split(',')[1]));
    const viewBoxHeight = Number((container.querySelector('svg')?.getAttribute('viewBox') ?? '').split(' ')[3]);
    for (const yVal of ys) {
      expect(yVal).toBeGreaterThanOrEqual(0);
      expect(yVal).toBeLessThanOrEqual(viewBoxHeight);
    }
  });

  it('draws the reference line when the domain reaches it', () => {
    render(
      <TypicalChart
        points={[pt(6, 30), pt(7, 34)]}
        today={[]}
        referenceValue={{ value: 32, label: 'Freezing' }}
      />,
    );
    expect(screen.getByTestId('reference-line')).toBeTruthy();
    expect(screen.getByText('Freezing')).toBeTruthy();
  });

  it('omits the reference line when the data is nowhere near it', () => {
    // An August chart spanning 45-79°F must not be stretched down to 32°F
    // just to draw a freezing line, wasting a third of its height.
    render(
      <TypicalChart
        points={[pt(6, 60), pt(7, 75)]}
        today={[]}
        referenceValue={{ value: 32, label: 'Freezing' }}
      />,
    );
    expect(screen.queryByTestId('reference-line')).toBeNull();
  });
});
