import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import TypicalChart, { type ChartPoint } from '../../src/app/components/TypicalChart';
import { MIN_DISTINCT_DAYS_FOR_BAND } from '../../src/shared/history';

function pt(hour: number, distinctDays: number | null): ChartPoint {
  return { hour, medianSec: 1800, p25Sec: 1700, p75Sec: 1900, distinctDays };
}

const OK = MIN_DISTINCT_DAYS_FOR_BAND;

describe('TypicalChart', () => {
  it('draws a band where the bucket has enough distinct days', () => {
    render(<TypicalChart points={[pt(6, OK), pt(7, OK)]} today={[]} />);
    expect(screen.getAllByTestId('band')).toHaveLength(1);
  });

  it('withholds the band but still draws the median when data is thin', () => {
    render(<TypicalChart points={[pt(6, 1), pt(7, 1)]} today={[]} />);
    expect(screen.queryAllByTestId('band')).toHaveLength(0);
    expect(screen.getByTestId('median')).toBeTruthy();
  });

  it('emits two polygons when a thin hour interrupts the band', () => {
    render(<TypicalChart points={[pt(6, OK), pt(7, OK), pt(8, 1), pt(9, OK), pt(10, OK)]} today={[]} />);
    expect(screen.getAllByTestId('band')).toHaveLength(2);
  });

  it('annotates the latest reading as the now-dot', () => {
    render(
      <TypicalChart
        points={[pt(6, OK), pt(7, OK), pt(8, OK)]}
        today={[
          { hour: 6, durationSec: 1800 },
          { hour: 7, durationSec: 2280 },
        ]}
      />,
    );
    expect(screen.getByTestId('now-dot')).toBeTruthy();
    expect(screen.getByText(/now · 38m/)).toBeTruthy(); // 2280s = 38 min
  });

  it('renders no today line when there are no readings yet', () => {
    render(<TypicalChart points={[pt(6, OK), pt(7, OK)]} today={[]} />);
    expect(screen.queryByTestId('today')).toBeNull();
    expect(screen.queryByTestId('now-dot')).toBeNull();
  });

  it('uses design tokens, never hardcoded hex colors', () => {
    // The mock is light-mode only (#faf7f0 / #eae4d8); the app ships a dark
    // token set, so any literal hex here would be invisible or wrong in
    // dark mode. Grep for any hex literal, not just the mock's specific
    // palette, so a hardcoded color introduced later is caught too.
    const { container } = render(<TypicalChart points={[pt(6, OK), pt(7, OK)]} today={[]} />);
    expect(container.innerHTML).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it('renders the empty-history message instead of NaN coordinates when every value is null', () => {
    // Regression: Math.min()/Math.max() of an empty array are +/-Infinity,
    // and `(-Infinity) || 1` does not fall back to 1 (-Infinity is truthy),
    // so an unguarded component would compute NaN for every y() and render
    // a blank (but not empty) SVG with no error.
    render(
      <TypicalChart
        points={[
          { hour: 6, medianSec: null, p25Sec: null, p75Sec: null, distinctDays: null },
          { hour: 7, medianSec: null, p25Sec: null, p75Sec: null, distinctDays: null },
        ]}
        today={[]}
      />,
    );
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText(/No history for this route yet/)).toBeTruthy();
  });
});
