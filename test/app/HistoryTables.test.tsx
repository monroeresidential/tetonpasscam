import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import SeasonCompare from '../../src/app/components/SeasonCompare';
import WorstDays from '../../src/app/components/WorstDays';

describe('WorstDays', () => {
  it('lists each day with its peak', () => {
    render(
      <WorstDays
        worstDays={[
          { date: '2026-08-11', peakSec: 3600 },
          { date: '2026-08-12', peakSec: 3000 },
        ]}
        recordingSince="2026-08-08"
      />,
    );
    expect(screen.getByText('60 min peak')).toBeTruthy(); // 3600s
    expect(screen.getByText('50 min peak')).toBeTruthy(); // 3000s
  });

  it('shows an empty state, mentioning when recording started, when null', () => {
    render(<WorstDays worstDays={null} recordingSince="2026-08-08" />);
    expect(screen.getByText(/not enough history yet/i)).toBeTruthy();
    expect(screen.getByText(/Aug 8/)).toBeTruthy();
  });

  it('renders a short list as-is rather than padding to three', () => {
    render(<WorstDays worstDays={[{ date: '2026-08-11', peakSec: 3600 }]} recordingSince="2026-08-08" />);
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });
});

describe('SeasonCompare', () => {
  it('shows summer and omits winter rows that are null', () => {
    render(
      <SeasonCompare seasonMedians={{ summer: 2040, winter: null }} closureDays={{ winter: null }} />,
    );
    expect(screen.getByText(/34 min/)).toBeTruthy(); // 2040s
    expect(screen.getByText(/after the first snow/i)).toBeTruthy();
  });

  it('shows both medians and the closure count once winter data exists', () => {
    render(
      <SeasonCompare seasonMedians={{ summer: 2040, winter: 2460 }} closureDays={{ winter: 11 }} />,
    );
    expect(screen.getByText(/34 min/)).toBeTruthy();
    expect(screen.getByText(/41 min/)).toBeTruthy(); // 2460s
    expect(screen.getByText('11')).toBeTruthy();
  });

  it('does not claim zero closures when the count is unknown', () => {
    render(
      <SeasonCompare seasonMedians={{ summer: 2040, winter: 2460 }} closureDays={{ winter: null }} />,
    );
    expect(screen.queryByText(/^0$/)).toBeNull();
  });
});
