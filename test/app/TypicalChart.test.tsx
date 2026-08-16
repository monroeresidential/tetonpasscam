import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import TypicalChart, { type ChartPoint } from '../../src/app/components/TypicalChart';
import { MIN_DISTINCT_DAYS_FOR_BAND } from '../../src/shared/history';

function pt(hour: number, distinctDays: number | null): ChartPoint {
  return { hour, median: 1800, p25: 1700, p75: 1900, distinctDays };
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
          { hour: 6, value: 1800 },
          { hour: 7, value: 2280 },
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
    // secondary and referenceValue are included so the grep also covers
    // the elements they render, not just the primary series.
    const { container } = render(
      <TypicalChart
        points={[pt(6, OK), pt(7, OK)]}
        secondary={[pt(6, OK), pt(7, OK)]}
        today={[]}
        referenceValue={{ value: 1800, label: 'Typical' }}
      />,
    );
    expect(container.innerHTML).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it('defaults to the travel-time accessible name when no ariaLabel is given', () => {
    render(<TypicalChart points={[pt(6, OK), pt(7, OK)]} today={[]} />);
    expect(
      screen.getByRole('img', {
        name: 'Travel time by hour of day, today against the typical range',
      }),
    ).toBeTruthy();
  });

  it('uses a supplied ariaLabel instead of the travel-time default', () => {
    render(
      <TypicalChart
        points={[pt(6, OK), pt(7, OK)]}
        today={[]}
        ariaLabel="Temperature by hour of day, today against the typical range"
      />,
    );
    expect(
      screen.getByRole('img', {
        name: 'Temperature by hour of day, today against the typical range',
      }),
    ).toBeTruthy();
  });

  it('renders the empty-history message instead of NaN coordinates when every value is null', () => {
    // Regression: Math.min()/Math.max() of an empty array are +/-Infinity,
    // and `(-Infinity) || 1` does not fall back to 1 (-Infinity is truthy),
    // so an unguarded component would compute NaN for every y() and render
    // a blank (but not empty) SVG with no error.
    render(
      <TypicalChart
        points={[
          { hour: 6, median: null, p25: null, p75: null, distinctDays: null },
          { hour: 7, median: null, p25: null, p75: null, distinctDays: null },
        ]}
        today={[]}
      />,
    );
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText(/No history for this route yet/)).toBeTruthy();
  });

  it('defaults to the route-history empty message when no emptyMessage is given', () => {
    render(<TypicalChart points={[]} today={[]} />);
    expect(screen.getByText('No history for this route yet.')).toBeTruthy();
  });

  it('uses a supplied emptyMessage instead of the route-history default', () => {
    render(
      <TypicalChart
        points={[]}
        today={[]}
        emptyMessage="Temperature history is still being collected for this station."
      />,
    );
    expect(screen.queryByText(/No history for this route yet/)).toBeNull();
    expect(
      screen.getByText('Temperature history is still being collected for this station.'),
    ).toBeTruthy();
  });
});

// Axis furniture. Mock 2c specified two axis lines, three y-ticks
// (30m/45m/60m) and x-labels every three hours; the implementation shipped
// without any of them, leaving both charts readable as shapes but not as
// data -- you could see the shape of the day without being able to read a
// single value off it except "now".
describe('TypicalChart — axes', () => {
  function pts(): ChartPoint[] {
    return [
      { hour: 4, median: 1800, p25: 1700, p75: 1900, distinctDays: 9 },
      { hour: 7, median: 2400, p25: 2300, p75: 2500, distinctDays: 9 },
      { hour: 10, median: 3000, p25: 2900, p75: 3100, distinctDays: 9 },
    ];
  }

  it('labels the y-axis at the domain min, midpoint and max, via formatValue', () => {
    render(<TypicalChart points={pts()} today={[]} />);
    // Domain spans p25 of the first bucket (1700s = 28m) to p75 of the last
    // (3100s = 52m); midpoint 2400s = 40m. Default formatter renders minutes.
    expect(screen.getByText('28m')).toBeTruthy();
    expect(screen.getByText('40m')).toBeTruthy();
    expect(screen.getByText('52m')).toBeTruthy();
  });

  it('routes y-tick labels through formatValue, so a unit switch relabels them', () => {
    render(
      <TypicalChart points={pts()} today={[]} formatValue={(v) => `${Math.round(v)}u`} />,
    );
    expect(screen.getByText('1700u')).toBeTruthy();
    expect(screen.getByText('3100u')).toBeTruthy();
    // The minute-formatted labels must be gone entirely, not merely joined.
    expect(screen.queryByText('28m')).toBeNull();
  });

  it('labels the x-axis every three hours across the plotted range', () => {
    render(<TypicalChart points={pts()} today={[]} />);
    expect(screen.getByText('4 AM')).toBeTruthy();
    expect(screen.getByText('7 AM')).toBeTruthy();
    expect(screen.getByText('10 AM')).toBeTruthy();
  });

  it('renders hours past noon in 12-hour form, not 13/14', () => {
    render(
      <TypicalChart
        points={[
          { hour: 10, median: 1800, p25: 1700, p75: 1900, distinctDays: 9 },
          { hour: 13, median: 2400, p25: 2300, p75: 2500, distinctDays: 9 },
          { hour: 16, median: 3000, p25: 2900, p75: 3100, distinctDays: 9 },
        ]}
        today={[]}
      />,
    );
    expect(screen.getByText('1 PM')).toBeTruthy();
    expect(screen.getByText('4 PM')).toBeTruthy();
    expect(screen.queryByText('13 AM')).toBeNull();
  });

  it('draws the two axis lines', () => {
    render(<TypicalChart points={pts()} today={[]} />);
    expect(screen.getByTestId('axis-y')).toBeTruthy();
    expect(screen.getByTestId('axis-x')).toBeTruthy();
  });

  // NOTE: this suite originally asserted that compact mode rendered NO axis
  // furniture. That expectation was reversed deliberately -- see the
  // "compact keeps its axes" suite below -- after the home card was
  // rendered and turned out to be a bare line with no scale. The assertion
  // was removed because the BEHAVIOUR changed by decision, not because it
  // was inconvenient; what compact still suppresses is pinned there.
});

// The reference line draws only when the data actually crosses it. The
// original condition used an absolute proximity constant, which was
// meaningless once this component became unit-agnostic: 8 against a
// drive-time domain measured in seconds (~900 units wide) is 0.9% and
// effectively never fires, while 8 against a temperature domain in degrees
// (~61 units wide) is 13% and fires almost always.
describe('TypicalChart — reference line is drawn only when the data crosses it', () => {
  function tempPt(hour: number, median: number): ChartPoint {
    return { hour, median, p25: median - 5, p75: median + 5, distinctDays: 9 };
  }

  it('draws when the reference sits inside the plotted range', () => {
    // Range [25, 39] via p25/p75; 32 is inside it.
    render(
      <TypicalChart
        points={[tempPt(6, 30), tempPt(7, 34)]}
        today={[]}
        referenceValue={{ value: 32, label: 'Freezing' }}
      />,
    );
    expect(screen.getByTestId('reference-line')).toBeTruthy();
  });

  it('omits it when every plotted value is above it', () => {
    // A summer chart: range [39, 104]. Drawing a 32 line here would stretch
    // the domain down into empty space and label the bottom tick with a
    // value no series ever reaches.
    render(
      <TypicalChart
        points={[tempPt(6, 44), tempPt(7, 99)]}
        today={[]}
        referenceValue={{ value: 32, label: 'Freezing' }}
      />,
    );
    expect(screen.queryByTestId('reference-line')).toBeNull();
  });

  it('does not stretch the y-domain when the reference is omitted', () => {
    // The lowest y-tick must describe the DATA, not the withheld reference.
    render(
      <TypicalChart
        points={[tempPt(6, 44), tempPt(7, 99)]}
        today={[]}
        formatValue={(v) => `${Math.round(v)}F`}
        referenceValue={{ value: 32, label: 'Freezing' }}
      />,
    );
    expect(screen.getByText('39F')).toBeTruthy(); // p25 of the coldest bucket
    expect(screen.queryByText('32F')).toBeNull();
  });

  it('draws when the reference lands exactly on the domain edge', () => {
    // Boundary: p25 of the coldest bucket IS the reference value.
    render(
      <TypicalChart
        points={[tempPt(6, 37), tempPt(7, 50)]}
        today={[]}
        referenceValue={{ value: 32, label: 'Freezing' }}
      />,
    );
    expect(screen.getByTestId('reference-line')).toBeTruthy();
  });
});

// The now-label is centered on its dot, so a reading at either edge of the
// plot ran past the viewBox and got clipped -- the drive-time chart read
// "now · 3" instead of "now · 37m". The anchor flips so the text always
// grows inward.
describe('TypicalChart — now-label stays inside the viewBox', () => {
  function pt(hour: number): ChartPoint {
    return { hour, median: 1800, p25: 1700, p75: 1900, distinctDays: 9 };
  }
  const label = () => screen.getByText(/now ·/);

  it('anchors to the end when the latest reading is at the right edge', () => {
    render(<TypicalChart points={[pt(4), pt(10)]} today={[{ hour: 10, value: 2280 }]} />);
    expect(label().getAttribute('text-anchor')).toBe('end');
  });

  it('anchors to the start when the only reading is at the left edge', () => {
    render(<TypicalChart points={[pt(4), pt(10)]} today={[{ hour: 4, value: 2280 }]} />);
    expect(label().getAttribute('text-anchor')).toBe('start');
  });

  it('stays centered when the reading is mid-chart', () => {
    render(<TypicalChart points={[pt(4), pt(10)]} today={[{ hour: 7, value: 2280 }]} />);
    expect(label().getAttribute('text-anchor')).toBe('middle');
  });

  it('renders the label text in full regardless of anchor', () => {
    // The clipping was visual, not textual -- guard that the string itself
    // is never shortened as a workaround.
    render(<TypicalChart points={[pt(4), pt(10)]} today={[{ hour: 10, value: 2280 }]} />);
    expect(screen.getByText('now · 38m')).toBeTruthy();
  });
});

// Compact mode originally suppressed all axis furniture on the theory that
// the home card is a teaser. Rendered, that produced a bare line with no
// scale -- you could not tell 30 minutes from 90. Compact now means only
// "no now-label text"; the axes render on both surfaces.
describe('TypicalChart — compact keeps its axes', () => {
  function pt(hour: number, median: number): ChartPoint {
    return { hour, median, p25: median - 60, p75: median + 60, distinctDays: 9 };
  }
  const points = [pt(5, 1740), pt(8, 2400), pt(11, 1860)];

  it('renders axis lines and tick labels in compact mode', () => {
    render(<TypicalChart points={points} today={[]} compact />);
    expect(screen.getByTestId('axis-y')).toBeTruthy();
    expect(screen.getByTestId('axis-x')).toBeTruthy();
    expect(screen.getByText('28m')).toBeTruthy(); // p25 of the lowest bucket
    expect(screen.getByText('5 AM')).toBeTruthy();
  });

  it('still suppresses the now-label text while keeping the dot', () => {
    render(<TypicalChart points={points} today={[{ hour: 8, value: 2400 }]} compact />);
    expect(screen.getByTestId('now-dot')).toBeTruthy();
    expect(screen.queryByText(/now ·/)).toBeNull();
  });

  it('renders the same axis furniture as the non-compact chart', () => {
    // The two surfaces should not disagree about how a chart is labelled.
    const { container: compactSvg } = render(<TypicalChart points={points} today={[]} compact />);
    const { container: fullSvg } = render(<TypicalChart points={points} today={[]} />);
    const count = (c: HTMLElement, sel: string) => c.querySelectorAll(sel).length;
    expect(count(compactSvg, 'text')).toBe(count(fullSvg, 'text'));
    expect(count(compactSvg, 'line')).toBe(count(fullSvg, 'line'));
  });
});

// The now-label sat a fixed 14 units above its dot with no awareness of
// what was underneath. Since the label and the today line share
// --color-accent, an overlap was same-colour-on-same-colour: on the live
// temperature chart "now · 46°F" landed directly on the trace and was
// genuinely hard to read.
describe('TypicalChart — now-label legibility and placement', () => {
  function pt(hour: number, median: number): ChartPoint {
    return { hour, median, p25: median - 200, p75: median + 200, distinctDays: 9 };
  }
  const points = [pt(4, 1800), pt(8, 2400), pt(12, 1800)];
  const label = () => screen.getByText(/now ·/);

  it('knocks a card-coloured halo out behind the text', () => {
    // paint-order:stroke draws the stroke first and the fill over it, so
    // the label punches a gap through whatever sits behind -- the today
    // line, the median, gridlines, or the band edge.
    render(<TypicalChart points={points} today={[{ hour: 6, value: 2000 }]} />);
    const el = label();
    expect(el.getAttribute('paint-order')).toBe('stroke');
    expect(el.getAttribute('stroke')).toBe('var(--color-card)');
    expect(Number(el.getAttribute('stroke-width'))).toBeGreaterThan(0);
  });

  it('sits ABOVE the dot when the line rises into it', () => {
    // Rising means the line approaches from below, leaving the space above
    // the dot clear.
    render(
      <TypicalChart
        points={points}
        today={[
          { hour: 5, value: 1800 },
          { hour: 6, value: 2200 },
        ]}
      />,
    );
    const dotY = Number(screen.getByTestId('now-dot').getAttribute('cy'));
    expect(Number(label().getAttribute('y'))).toBeLessThan(dotY);
  });

  it('sits BELOW the dot when the line falls into it', () => {
    // Falling means the line comes from higher on screen, so the space
    // above the dot is exactly where the trace already is.
    render(
      <TypicalChart
        points={points}
        today={[
          { hour: 5, value: 2200 },
          { hour: 6, value: 1800 },
        ]}
      />,
    );
    const dotY = Number(screen.getByTestId('now-dot').getAttribute('cy'));
    expect(Number(label().getAttribute('y'))).toBeGreaterThan(dotY);
  });

  it('keeps the label inside the plot area when the reading is at the top', () => {
    // A dot at the very top must not push its label off the top edge.
    render(
      <TypicalChart
        points={points}
        today={[
          { hour: 5, value: 1000 },
          { hour: 6, value: 2600 },
        ]}
      />,
    );
    expect(Number(label().getAttribute('y'))).toBeGreaterThanOrEqual(0);
  });

  it('keeps the label inside the plot area when the reading is at the bottom', () => {
    render(
      <TypicalChart
        points={points}
        today={[
          { hour: 5, value: 2600 },
          { hour: 6, value: 1000 },
        ]}
      />,
    );
    const viewBoxHeight = 260;
    expect(Number(label().getAttribute('y'))).toBeLessThanOrEqual(viewBoxHeight);
  });

  it('places the label above when there is only one reading to go on', () => {
    // No previous point means no slope; default to the historical placement.
    render(<TypicalChart points={points} today={[{ hour: 6, value: 2000 }]} />);
    const dotY = Number(screen.getByTestId('now-dot').getAttribute('cy'));
    expect(Number(label().getAttribute('y'))).toBeLessThan(dotY);
  });
});
