import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import DriveTimes from '../../src/app/components/DriveTimes';
import type { ApiStatus } from '../../src/shared/types';

function row(overrides: Partial<ApiStatus['travelTimes'][number]>): ApiStatus['travelTimes'][number] {
  return {
    slug: 'victor-jackson-eb',
    name: 'Victor → Jackson',
    durationSec: 1500,
    typicalSec: 1200,
    capturedAt: '2026-08-09T23:48:00.000Z',
    ...overrides,
  };
}

// Verbal delta mapping (spec, verbatim): diffSec = durationSec - typicalSec.
// The threshold comparison happens on the un-rounded SECOND value, and only
// once a band is crossed do we round to whole minutes for display -- doing
// it the other way (round to minutes, then threshold on minutes) would flip
// -299s (4.98 rounded min) into the "faster" band, contradicting the pinned
// -299s => "about usual" case below. See DriveTimes.tsx for the same note.
describe('DriveTimes verbal delta mapping', () => {
  it('diff exactly -300s (5 min faster) reads "5 min faster than usual"', () => {
    render(<DriveTimes travelTimes={[row({ durationSec: 900, typicalSec: 1200 })]} />);
    const delta = screen.getByText('5 min faster than usual');
    expect(delta.className).toMatch(/delta-pos/);
  });

  it('diff -299s (just inside the band) reads "about usual"', () => {
    render(<DriveTimes travelTimes={[row({ durationSec: 901, typicalSec: 1200 })]} />);
    expect(screen.getByText('about usual')).toBeInTheDocument();
    expect(screen.queryByText(/faster than usual/)).not.toBeInTheDocument();
  });

  it('diff +299s (just inside the band) reads "about usual"', () => {
    render(<DriveTimes travelTimes={[row({ durationSec: 1499, typicalSec: 1200 })]} />);
    expect(screen.getByText('about usual')).toBeInTheDocument();
    expect(screen.queryByText(/slower than usual/)).not.toBeInTheDocument();
  });

  it('diff exactly +300s (5 min slower) reads "5 min slower than usual"', () => {
    render(<DriveTimes travelTimes={[row({ durationSec: 1500, typicalSec: 1200 })]} />);
    const delta = screen.getByText('5 min slower than usual');
    expect(delta.className).toMatch(/delta-neg/);
  });

  it('diff +480s (8 min slower) reads "8 min slower than usual"', () => {
    render(<DriveTimes travelTimes={[row({ durationSec: 1680, typicalSec: 1200 })]} />);
    const delta = screen.getByText('8 min slower than usual');
    expect(delta.className).toMatch(/delta-neg/);
  });

  it('a null typicalSec renders no delta text at all', () => {
    render(<DriveTimes travelTimes={[row({ durationSec: 1500, typicalSec: null })]} />);
    expect(screen.queryByText(/usual/)).not.toBeInTheDocument();
  });

  it('"about usual" uses the muted token, not a delta color', () => {
    render(<DriveTimes travelTimes={[row({ durationSec: 1200, typicalSec: 1200 })]} />);
    const delta = screen.getByText('about usual');
    expect(delta.className).toMatch(/text-muted/);
  });
});

describe('DriveTimes layout', () => {
  it('renders the section heading and flip control copy', () => {
    render(<DriveTimes travelTimes={[row({})]} />);
    expect(screen.getByText('Drive times right now')).toBeInTheDocument();
    expect(screen.getByText('⇄ Flip direction')).toBeInTheDocument();
  });

  it('renders route name, destination sublabel, and numeral for a card', () => {
    render(
      <DriveTimes
        travelTimes={[row({ slug: 'victor-tetonvillage-eb', name: 'Victor → Teton Village' })]}
      />,
    );
    expect(screen.getByText('Victor → Teton Village')).toBeInTheDocument();
    expect(screen.getByText('JHMR')).toBeInTheDocument();
    expect(screen.getByText('25 min')).toBeInTheDocument();
  });

  it('derives "Town Square" and "Airport" sublabels from the other route slugs', () => {
    render(
      <DriveTimes
        travelTimes={[
          row({ slug: 'victor-jackson-eb', name: 'Victor → Jackson' }),
          row({ slug: 'victor-airport-eb', name: 'Victor → Airport' }),
        ]}
      />,
    );
    expect(screen.getByText('Town Square')).toBeInTheDocument();
    expect(screen.getByText('Airport')).toBeInTheDocument();
  });

  it('renders all 6 routes for a direction as cards', () => {
    const slugPrefixes = [
      'victor-jackson',
      'driggs-jackson',
      'victor-tetonvillage',
      'driggs-tetonvillage',
      'victor-airport',
      'driggs-airport',
    ];
    render(
      <DriveTimes
        travelTimes={slugPrefixes.map((prefix) => row({ slug: `${prefix}-eb`, name: prefix }))}
      />,
    );
    for (const prefix of slugPrefixes) {
      expect(screen.getByText(prefix)).toBeInTheDocument();
    }
  });
});

describe('DriveTimes flip-direction toggle', () => {
  it('filters rows by eb/wb suffix and flipping the toggle flips the visible set', async () => {
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

    const flipButton = screen.getByRole('button', { name: /flip direction/i });
    expect(flipButton).toHaveAttribute('aria-pressed', 'false');
    await user.click(flipButton);
    expect(flipButton).toHaveAttribute('aria-pressed', 'true');

    expect(screen.queryByText('Victor to Jackson (EB)')).not.toBeInTheDocument();
    expect(screen.getByText('Jackson to Victor (WB)')).toBeInTheDocument();
  });
});

describe('DriveTimes routes-omitted contract', () => {
  it('shows nothing extra when a direction has no travel-time rows', () => {
    render(<DriveTimes travelTimes={[row({ slug: 'victor-jackson-wb' })]} />);
    expect(screen.queryByText(/min/)).not.toBeInTheDocument();
  });
});

// share-cards T2: DriveTimes only needs to thread shareCode through to
// ShareButton correctly -- ShareButton's own behavior (URL construction,
// navigator.share/clipboard fallback, toast) is covered in
// ShareButton.test.tsx, not duplicated here.
describe('DriveTimes share button wiring', () => {
  it('is hidden when shareCode is omitted (existing callers/tests keep working unchanged)', () => {
    render(<DriveTimes travelTimes={[row({})]} />);
    expect(screen.queryByRole('button', { name: /share current conditions/i })).not.toBeInTheDocument();
  });

  it('is hidden when shareCode is explicitly null (pollerDead/no snapshot)', () => {
    render(<DriveTimes travelTimes={[row({})]} shareCode={null} />);
    expect(screen.queryByRole('button', { name: /share current conditions/i })).not.toBeInTheDocument();
  });

  it('renders when shareCode is present', () => {
    render(<DriveTimes travelTimes={[row({})]} shareCode="20260810-1412" />);
    expect(screen.getByRole('button', { name: /share current conditions/i })).toBeInTheDocument();
  });
});

// Moved from StatusBanner.test.tsx (Task 9 file-hygiene pass) -- this test
// exercises DriveTimes directly and had no business living in
// StatusBanner.test.tsx's file. Assertions kept identical.
describe('DriveTimes delta visibility on rerender', () => {
  it('drive time row hides delta when typicalSec null, shows ±min colored when present', () => {
    const { rerender } = render(
      <DriveTimes
        travelTimes={[
          {
            slug: 'victor-jackson-eb',
            name: 'Victor to Jackson',
            durationSec: 1500,
            typicalSec: null,
            capturedAt: '2026-08-09T23:48:00.000Z',
          },
        ]}
      />,
    );
    expect(screen.queryByText(/usual/)).not.toBeInTheDocument();

    rerender(
      <DriveTimes
        travelTimes={[
          {
            slug: 'victor-jackson-eb',
            name: 'Victor to Jackson',
            durationSec: 1500,
            typicalSec: 1200,
            capturedAt: '2026-08-09T23:48:00.000Z',
          },
        ]}
      />,
    );
    expect(screen.getByText(/usual/)).toBeInTheDocument();
  });
});
