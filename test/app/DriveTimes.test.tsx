import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import DriveTimes from '../../src/app/components/DriveTimes';
import type { ApiStatus } from '../../src/shared/types';

function row(overrides: Partial<ApiStatus['travelTimes'][number]>): ApiStatus['travelTimes'][number] {
  return {
    slug: 'victor-jackson-eb',
    name: 'Victor → Jackson',
    durationSec: 1500,
    typicalSec: 1200,
    capturedAt: '2026-08-09T23:48:00.000Z',
    stale: false,
    ...overrides,
  };
}

// Direction is now controlled from App (share-3a: lifted so StatusBanner's
// share pill and DriveTimes's flip agree on the same direction) -- every
// render below passes it explicitly rather than relying on internal state.
const noop = () => {};

// Verbal delta mapping (spec, verbatim): diffSec = durationSec - typicalSec.
// The threshold comparison happens on the un-rounded SECOND value, and only
// once a band is crossed do we round to whole minutes for display -- doing
// it the other way (round to minutes, then threshold on minutes) would flip
// -299s (4.98 rounded min) into the "faster" band, contradicting the pinned
// -299s => "about usual" case below. See DriveTimes.tsx for the same note.
describe('DriveTimes verbal delta mapping', () => {
  it('diff exactly -300s (5 min faster) reads "5 min faster than usual"', () => {
    render(
      <DriveTimes
        travelTimes={[row({ durationSec: 900, typicalSec: 1200 })]}
        direction="eb"
        onFlip={noop}
      />,
    );
    const delta = screen.getByText('5 min faster than usual');
    expect(delta.className).toMatch(/delta-pos/);
  });

  it('diff -299s (just inside the band) reads "about usual"', () => {
    render(
      <DriveTimes
        travelTimes={[row({ durationSec: 901, typicalSec: 1200 })]}
        direction="eb"
        onFlip={noop}
      />,
    );
    expect(screen.getByText('about usual')).toBeInTheDocument();
    expect(screen.queryByText(/faster than usual/)).not.toBeInTheDocument();
  });

  it('diff +299s (just inside the band) reads "about usual"', () => {
    render(
      <DriveTimes
        travelTimes={[row({ durationSec: 1499, typicalSec: 1200 })]}
        direction="eb"
        onFlip={noop}
      />,
    );
    expect(screen.getByText('about usual')).toBeInTheDocument();
    expect(screen.queryByText(/slower than usual/)).not.toBeInTheDocument();
  });

  it('diff exactly +300s (5 min slower) reads "5 min slower than usual"', () => {
    render(
      <DriveTimes
        travelTimes={[row({ durationSec: 1500, typicalSec: 1200 })]}
        direction="eb"
        onFlip={noop}
      />,
    );
    const delta = screen.getByText('5 min slower than usual');
    expect(delta.className).toMatch(/delta-neg/);
  });

  it('diff +480s (8 min slower) reads "8 min slower than usual"', () => {
    render(
      <DriveTimes
        travelTimes={[row({ durationSec: 1680, typicalSec: 1200 })]}
        direction="eb"
        onFlip={noop}
      />,
    );
    const delta = screen.getByText('8 min slower than usual');
    expect(delta.className).toMatch(/delta-neg/);
  });

  it('a null typicalSec renders no delta text at all', () => {
    render(
      <DriveTimes
        travelTimes={[row({ durationSec: 1500, typicalSec: null })]}
        direction="eb"
        onFlip={noop}
      />,
    );
    expect(screen.queryByText(/usual/)).not.toBeInTheDocument();
  });

  it('"about usual" uses the muted token, not a delta color', () => {
    render(
      <DriveTimes
        travelTimes={[row({ durationSec: 1200, typicalSec: 1200 })]}
        direction="eb"
        onFlip={noop}
      />,
    );
    const delta = screen.getByText('about usual');
    expect(delta.className).toMatch(/text-muted/);
  });
});

describe('DriveTimes layout', () => {
  it('renders the section heading and flip control copy', () => {
    render(<DriveTimes travelTimes={[row({})]} direction="eb" onFlip={noop} />);
    expect(screen.getByText('Drive times right now')).toBeInTheDocument();
    expect(screen.getByText('⇄ Flip direction')).toBeInTheDocument();
  });

  it('renders route name, destination sublabel, and numeral for a card', () => {
    render(
      <DriveTimes
        travelTimes={[row({ slug: 'victor-tetonvillage-eb', name: 'Victor → Teton Village' })]}
        direction="eb"
        onFlip={noop}
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
        direction="eb"
        onFlip={noop}
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
        direction="eb"
        onFlip={noop}
      />,
    );
    for (const prefix of slugPrefixes) {
      expect(screen.getByText(prefix)).toBeInTheDocument();
    }
  });
});

// DriveTimes no longer owns direction state (share-3a: lifted to App so
// StatusBanner's share pill and this flip button share one source of
// truth) -- it's now a fully controlled component, so these tests assert
// the row filtering reacts to the `direction` prop and that the flip
// button calls back to the parent rather than toggling anything itself.
describe('DriveTimes controlled direction', () => {
  it('filters rows by eb/wb suffix according to the direction prop', () => {
    const { rerender } = render(
      <DriveTimes
        travelTimes={[
          row({ slug: 'victor-jackson-eb', name: 'Victor to Jackson (EB)' }),
          row({ slug: 'victor-jackson-wb', name: 'Jackson to Victor (WB)' }),
        ]}
        direction="eb"
        onFlip={noop}
      />,
    );

    expect(screen.getByText('Victor to Jackson (EB)')).toBeInTheDocument();
    expect(screen.queryByText('Jackson to Victor (WB)')).not.toBeInTheDocument();

    rerender(
      <DriveTimes
        travelTimes={[
          row({ slug: 'victor-jackson-eb', name: 'Victor to Jackson (EB)' }),
          row({ slug: 'victor-jackson-wb', name: 'Jackson to Victor (WB)' }),
        ]}
        direction="wb"
        onFlip={noop}
      />,
    );

    expect(screen.queryByText('Victor to Jackson (EB)')).not.toBeInTheDocument();
    expect(screen.getByText('Jackson to Victor (WB)')).toBeInTheDocument();
  });

  it('the flip button reflects the direction prop via aria-pressed and calls onFlip when clicked', async () => {
    const user = userEvent.setup();
    const onFlip = vi.fn();
    render(<DriveTimes travelTimes={[row({})]} direction="eb" onFlip={onFlip} />);

    const flipButton = screen.getByRole('button', { name: /flip direction/i });
    expect(flipButton).toHaveAttribute('aria-pressed', 'false');

    await user.click(flipButton);
    expect(onFlip).toHaveBeenCalledTimes(1);
  });

  it('aria-pressed reads true when direction="wb" is passed in', () => {
    render(<DriveTimes travelTimes={[row({})]} direction="wb" onFlip={noop} />);
    expect(screen.getByRole('button', { name: /flip direction/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});

describe('DriveTimes routes-omitted contract', () => {
  it('shows nothing extra when a direction has no travel-time rows', () => {
    render(
      <DriveTimes travelTimes={[row({ slug: 'victor-jackson-wb' })]} direction="eb" onFlip={noop} />,
    );
    expect(screen.queryByText(/min/)).not.toBeInTheDocument();
  });
});

// Overnight gap (stale-drive-times): the server keeps a route's last reading
// up to TRAVEL_TIME_MAX_AGE_HOURS and flags it `stale` once past the live
// freshness window, instead of omitting it -- these assert the muted/"as of"
// treatment that replaces the normal duration + delta chip.
describe('DriveTimes stale rows', () => {
  it('a stale row shows the duration muted, an "as of" label, and no delta chip', () => {
    render(
      <DriveTimes
        travelTimes={[
          row({
            durationSec: 2100,
            typicalSec: null,
            capturedAt: '2026-08-10T04:50:00.000Z', // 10:50 PM America/Denver
            stale: true,
          }),
        ]}
        direction="eb"
        onFlip={noop}
      />,
    );

    const duration = screen.getByText('35 min');
    expect(duration.className).toMatch(/text-muted/);

    const asOf = screen.getByText('as of 10:50 PM');
    expect(asOf).toBeInTheDocument();
    expect(asOf.className).toMatch(/text-muted/);

    expect(screen.queryByText(/usual/)).not.toBeInTheDocument();
  });

  it('a fresh row renders exactly as before: emphasized duration, no "as of" label', () => {
    render(
      <DriveTimes
        travelTimes={[row({ durationSec: 1500, typicalSec: 1200, stale: false })]}
        direction="eb"
        onFlip={noop}
      />,
    );

    const duration = screen.getByText('25 min');
    expect(duration.className).not.toMatch(/text-muted/);
    expect(screen.queryByText(/^as of /)).not.toBeInTheDocument();
    expect(screen.getByText('5 min slower than usual')).toBeInTheDocument();
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
            stale: false,
          },
        ]}
        direction="eb"
        onFlip={noop}
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
            stale: false,
          },
        ]}
        direction="eb"
        onFlip={noop}
      />,
    );
    expect(screen.getByText(/usual/)).toBeInTheDocument();
  });
});
