import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import DriveTimes from '../../src/app/components/DriveTimes';
import type { ApiStatus } from '../../src/shared/types';

function row(overrides: Partial<ApiStatus['travelTimes'][number]>): ApiStatus['travelTimes'][number] {
  return {
    slug: 'victor-jackson-eb',
    name: 'Victor to Jackson',
    durationSec: 1500,
    typicalSec: 1200,
    capturedAt: '2026-08-09T23:48:00.000Z',
    ...overrides,
  };
}

// Delta thresholds (from the plan): diff = durationSec - typicalSec.
//   diff <= +5min (300s)         => green
//   +5min < diff <= +15min (900s) => amber
//   diff > +15min                 => red
// Boundaries are pinned exactly at 300s and 900s below since "≤"/">" makes
// the edge behavior a real product decision, not an implementation detail.
describe('DriveTimes delta thresholds', () => {
  it('diff exactly +5min (300s) is green, not amber', () => {
    render(<DriveTimes travelTimes={[row({ durationSec: 1500, typicalSec: 1200 })]} />);
    const chip = screen.getByText(/vs typical/);
    expect(chip.className).toMatch(/green/);
  });

  it('diff just over +5min is amber', () => {
    render(<DriveTimes travelTimes={[row({ durationSec: 1501, typicalSec: 1200 })]} />);
    const chip = screen.getByText(/vs typical/);
    expect(chip.className).toMatch(/amber/);
  });

  it('diff exactly +15min (900s) is amber, not red', () => {
    render(<DriveTimes travelTimes={[row({ durationSec: 2100, typicalSec: 1200 })]} />);
    const chip = screen.getByText(/vs typical/);
    expect(chip.className).toMatch(/amber/);
  });

  it('diff just over +15min is red', () => {
    render(<DriveTimes travelTimes={[row({ durationSec: 2101, typicalSec: 1200 })]} />);
    const chip = screen.getByText(/vs typical/);
    expect(chip.className).toMatch(/red/);
  });

  it('a negative diff (faster than typical) is green', () => {
    render(<DriveTimes travelTimes={[row({ durationSec: 900, typicalSec: 1200 })]} />);
    const chip = screen.getByText(/vs typical/);
    expect(chip.className).toMatch(/green/);
  });
});

describe('DriveTimes direction toggle', () => {
  it('filters rows by eb/wb suffix and toggling flips the visible set', async () => {
    const user = userEvent.setup();
    render(
      <DriveTimes
        travelTimes={[
          row({ slug: 'victor-jackson-eb', name: 'Victor to Jackson (EB)' }),
          row({ slug: 'victor-jackson-wb', name: 'Jackson to Victor (WB)' }),
        ]}
      />,
    );

    expect(screen.getByText('Victor to Jackson (EB)')).toBeInTheDocument();
    expect(screen.queryByText('Jackson to Victor (WB)')).not.toBeInTheDocument();

    const wbButton = screen.getByRole('button', { name: /westbound/i });
    expect(wbButton).toHaveAttribute('aria-pressed', 'false');
    await user.click(wbButton);
    expect(wbButton).toHaveAttribute('aria-pressed', 'true');

    expect(screen.queryByText('Victor to Jackson (EB)')).not.toBeInTheDocument();
    expect(screen.getByText('Jackson to Victor (WB)')).toBeInTheDocument();
  });
});
