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
// Task 4 adds `town`/`onTownChange` as required props alongside it -- every
// call below now passes `town="victor"` (matching the default `row()` slug)
// plus a no-op `onTownChange` so the town filter never excludes the fixture
// rows these older tests were written against.
const noop = () => {};

// All twelve seeded route-directions. The filter test asserts 3 of 6 per
// direction, so a shorter fixture would pass for the wrong reason.
//
// durationSec is DELIBERATELY staggered per prefix (2280s + 60s per
// pair-index) rather than a single shared value -- do not "simplify" this
// back to one uniform duration. The typography test below targets "38 min"
// via `getByText` (a *single*-match query), and with the Victor-only filter
// active, all 3 of Victor's eb routes would otherwise share one duration and
// render identical "38 min" text, making that query ambiguous regardless of
// how DriveTimes is implemented. Victor -> Jackson (index 0) keeps 2280s/38min
// -- the value the assertion targets -- and every other prefix gets a
// distinct value so nothing else collides with it. wb mirrors the same
// stagger 120s lower so it stays distinct too, though no current test reads
// wb durations from this fixture.
//
// typicalSec is kept EQUAL to durationSec on every row (not staggered
// independently): diffSec = durationSec - typicalSec = 0 puts every row in
// the "about usual" band, so varying only the duration can't accidentally
// generate "faster/slower than usual" text as a side effect of this fixture
// fix -- no test reading ALL_TWELVE depends on delta copy, and this keeps it
// that way.
const PREFIXES = [
  ['victor-jackson', 'Victor → Jackson', 'Jackson → Victor'],
  ['driggs-jackson', 'Driggs → Jackson', 'Jackson → Driggs'],
  ['victor-tetonvillage', 'Victor → Teton Village', 'Teton Village → Victor'],
  ['driggs-tetonvillage', 'Driggs → Teton Village', 'Teton Village → Driggs'],
  ['victor-airport', 'Victor → Airport', 'Airport → Victor'],
  ['driggs-airport', 'Driggs → Airport', 'Airport → Driggs'],
] as const;

const ALL_TWELVE: ApiStatus['travelTimes'] = PREFIXES.flatMap(([prefix, ebName, wbName], index) => {
  const ebDurationSec = 2280 + index * 60;
  const wbDurationSec = 2160 + index * 60;
  return [
    {
      slug: `${prefix}-eb`,
      name: ebName,
      durationSec: ebDurationSec,
      typicalSec: ebDurationSec,
      capturedAt: '2026-08-16T22:50:00.000Z',
      stale: false,
    },
    {
      slug: `${prefix}-wb`,
      name: wbName,
      durationSec: wbDurationSec,
      typicalSec: wbDurationSec,
      capturedAt: '2026-08-16T22:50:00.000Z',
      stale: false,
    },
  ];
});

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
        town="victor"
        onTownChange={noop}
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
        town="victor"
        onTownChange={noop}
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
        town="victor"
        onTownChange={noop}
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
        town="victor"
        onTownChange={noop}
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
        town="victor"
        onTownChange={noop}
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
        town="victor"
        onTownChange={noop}
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
        town="victor"
        onTownChange={noop}
        onFlip={noop}
      />,
    );
    const delta = screen.getByText('about usual');
    expect(delta.className).toMatch(/text-muted/);
  });
});

describe('DriveTimes layout', () => {
  it('renders the section heading and flip control copy', () => {
    render(
      <DriveTimes travelTimes={[row({})]} direction="eb" town="victor" onTownChange={noop} onFlip={noop} />,
    );
    expect(screen.getByText('Drive times right now')).toBeInTheDocument();
    expect(screen.getByText('⇄ Flip direction')).toBeInTheDocument();
  });

  it('renders route name, destination sublabel, and numeral for a card', () => {
    render(
      <DriveTimes
        travelTimes={[row({ slug: 'victor-tetonvillage-eb', name: 'Victor → Teton Village' })]}
        direction="eb"
        town="victor"
        onTownChange={noop}
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
        town="victor"
        onTownChange={noop}
        onFlip={noop}
      />,
    );
    expect(screen.getByText('Town Square')).toBeInTheDocument();
    expect(screen.getByText('Airport')).toBeInTheDocument();
  });

  // Desktop (variant="desktop") is the one context where all 6 routes -- both
  // Idaho towns -- render for a single direction at once (README §2: the 2-up
  // grid shows both towns, only the phone segmented picker filters to one).
  // Without `variant="desktop"` here, the `town="victor"` default would only
  // surface half of these fixture routes.
  it('renders all 6 routes for a direction as cards on desktop (town filter bypassed)', () => {
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
        town="victor"
        onTownChange={noop}
        onFlip={noop}
        variant="desktop"
      />,
    );
    for (const prefix of slugPrefixes) {
      expect(screen.getByText(prefix)).toBeInTheDocument();
    }
  });
});

// Task 4: hierarchy (name promoted/numeral demoted), freshness stated once in
// the header instead of per row, and the Victor/Driggs town filter (Ruling
// R3: the Idaho town is the slug's first segment, direction-independent).
describe('DriveTimes hierarchy, header freshness, and town filter (Task 4)', () => {
  it('filters to the chosen Idaho town in BOTH directions', () => {
    // Ruling R3: the Idaho town is the slug's first segment regardless of
    // direction, so the same filter works eastbound and westbound.
    //
    // Reads each drive-row's own `textContent` rather than a page-wide
    // `screen.queryByText(/Driggs/)`: the phone-only Victor/Driggs Segmented
    // picker mounted below the header is always in the DOM (jsdom ignores
    // its `lg:hidden` CSS class) and legitimately renders the literal word
    // "Driggs" as its OTHER toggle option, so a page-wide query would
    // false-fail on the picker's own label, not on a filtered-in route. Scope
    // to the element you mean, not the whole document -- this is the same
    // fix as the "38 min" collision two tests down.
    const { rerender } = render(
      <DriveTimes travelTimes={ALL_TWELVE} direction="eb" town="victor" onTownChange={() => {}} onFlip={() => {}} />,
    );
    const ebRows = screen.getAllByTestId('drive-row');
    expect(ebRows).toHaveLength(3);
    expect(ebRows.some((row) => row.textContent?.includes('Driggs'))).toBe(false);

    rerender(
      <DriveTimes travelTimes={ALL_TWELVE} direction="wb" town="victor" onTownChange={() => {}} onFlip={() => {}} />,
    );
    const wbRows = screen.getAllByTestId('drive-row');
    expect(wbRows).toHaveLength(3);
    expect(wbRows.some((row) => row.textContent?.includes('Driggs'))).toBe(false);
  });

  it('states freshness once in the header, never per row', () => {
    render(<DriveTimes travelTimes={ALL_TWELVE} direction="eb" town="victor" onTownChange={() => {}} onFlip={() => {}} />);
    expect(screen.getAllByText(/^Updated /)).toHaveLength(1);
    expect(screen.queryByText(/as of /)).not.toBeInTheDocument();
  });

  it('shows no delta for a stale row', () => {
    const stale = [{ ...ALL_TWELVE[0], stale: true }];
    render(<DriveTimes travelTimes={stale} direction="eb" town="victor" onTownChange={() => {}} onFlip={() => {}} />);
    expect(screen.queryByText(/than usual|about usual/)).not.toBeInTheDocument();
  });

  // Fix 4 (final review): a row is `stale` precisely when ITS OWN
  // capturedAt lags behind its siblings, so the header must never pick the
  // newest of the visible rows -- that would print a fresh "Updated" time
  // directly above the one row whose whole point is being stale. Mirrors
  // `olderReportTime` in src/worker/poller/run.ts.
  it('states the header freshness from the OLDEST visible row, not the newest', () => {
    const mixed = [
      row({ slug: 'victor-jackson-eb', capturedAt: '2026-08-16T22:50:00.000Z' }),
      row({ slug: 'victor-airport-eb', capturedAt: '2026-08-16T18:00:00.000Z', stale: true }),
    ];
    render(<DriveTimes travelTimes={mixed} direction="eb" town="victor" onTownChange={() => {}} onFlip={() => {}} />);
    // 18:00 UTC = 12:00 PM America/Denver (MDT, UTC-6) -- the older of the
    // two, not 22:50 UTC's 4:50 PM.
    expect(screen.getByText(/^Updated /).textContent).toBe('Updated 12:00 PM');
  });

  // Fix 4 (final review): staleness must reach assistive tech independently
  // of colour (rule 8 / WCAG 1.4.1) even though the header now states only
  // one, non-row-specific timestamp.
  it('gives a stale row its own sr-only "as of" text, distinct from the header timestamp', () => {
    const mixed = [
      row({ slug: 'victor-jackson-eb', capturedAt: '2026-08-16T22:50:00.000Z' }),
      row({ slug: 'victor-airport-eb', capturedAt: '2026-08-16T18:00:00.000Z', stale: true }),
    ];
    render(<DriveTimes travelTimes={mixed} direction="eb" town="victor" onTownChange={() => {}} onFlip={() => {}} />);
    const staleAsOf = screen.getByText(/^as of /);
    expect(staleAsOf).toHaveClass('sr-only');
    expect(staleAsOf.textContent).toBe('as of 12:00 PM');
  });

  it('promotes the route name to the display face and demotes the numeral', () => {
    // `getByText(/^38 min$/)` is a singular-match query -- it only stays
    // unambiguous because ALL_TWELVE staggers each prefix's durationSec (see
    // the fixture comment above); "38 min" is unique to Victor -> Jackson
    // among the 3 rows this town+direction filter leaves visible.
    render(<DriveTimes travelTimes={ALL_TWELVE} direction="eb" town="victor" onTownChange={() => {}} onFlip={() => {}} />);
    expect(screen.getByText('Victor → Jackson')).toHaveClass('font-display');
    expect(screen.getByText(/^38 min$/)).toHaveClass('text-[19px]');
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
        town="victor"
        onTownChange={noop}
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
        town="victor"
        onTownChange={noop}
        onFlip={noop}
      />,
    );

    expect(screen.queryByText('Victor to Jackson (EB)')).not.toBeInTheDocument();
    expect(screen.getByText('Jackson to Victor (WB)')).toBeInTheDocument();
  });

  it('the flip button reflects the direction prop via aria-pressed and calls onFlip when clicked', async () => {
    const user = userEvent.setup();
    const onFlip = vi.fn();
    render(
      <DriveTimes
        travelTimes={[row({})]}
        direction="eb"
        town="victor"
        onTownChange={noop}
        onFlip={onFlip}
      />,
    );

    const flipButton = screen.getByRole('button', { name: /flip direction/i });
    expect(flipButton).toHaveAttribute('aria-pressed', 'false');

    await user.click(flipButton);
    expect(onFlip).toHaveBeenCalledTimes(1);
  });

  it('aria-pressed reads true when direction="wb" is passed in', () => {
    render(
      <DriveTimes travelTimes={[row({})]} direction="wb" town="victor" onTownChange={noop} onFlip={noop} />,
    );
    expect(screen.getByRole('button', { name: /flip direction/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});

describe('DriveTimes routes-omitted contract', () => {
  it('shows nothing extra when a direction has no travel-time rows', () => {
    render(
      <DriveTimes
        travelTimes={[row({ slug: 'victor-jackson-wb' })]}
        direction="eb"
        town="victor"
        onTownChange={noop}
        onFlip={noop}
      />,
    );
    expect(screen.queryByText(/min/)).not.toBeInTheDocument();
  });
});

// Overnight gap (stale-drive-times): the server keeps a route's last reading
// up to TRAVEL_TIME_MAX_AGE_HOURS and flags it `stale` once past the live
// freshness window, instead of omitting it -- these assert the muted
// treatment that replaces the normal duration + delta chip. Task 4 moves
// freshness ("as of"/"Updated") out of the per-row card into the section
// header, so a stale row now shows the muted numeral and NOTHING beneath it
// (no delta, no per-row timestamp) rather than the old "as of" line.
describe('DriveTimes stale rows', () => {
  it('a stale row shows the duration muted and no VISIBLE delta chip or "as of" text beneath it', () => {
    render(
      <DriveTimes
        travelTimes={[
          row({
            durationSec: 2100,
            typicalSec: null,
            capturedAt: '2026-08-10T04:50:00.000Z',
            stale: true,
          }),
        ]}
        direction="eb"
        town="victor"
        onTownChange={noop}
        onFlip={noop}
      />,
    );

    const duration = screen.getByText('35 min');
    expect(duration.className).toMatch(/text-muted/);

    expect(screen.queryByText(/usual/)).not.toBeInTheDocument();
    // The row DOES carry an "as of" string now (Fix 4, sr-only -- staleness
    // must reach assistive tech, not just colour per WCAG 1.4.1), but it
    // must stay visually hidden so the row's on-screen appearance is
    // unchanged. See the sr-only-specific test below for the positive case.
    expect(screen.getByText(/^as of /)).toHaveClass('sr-only');
  });

  it('a fresh row renders exactly as before: emphasized duration, no "as of" label', () => {
    render(
      <DriveTimes
        travelTimes={[row({ durationSec: 1500, typicalSec: 1200, stale: false })]}
        direction="eb"
        town="victor"
        onTownChange={noop}
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
        town="victor"
        onTownChange={noop}
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
        town="victor"
        onTownChange={noop}
        onFlip={noop}
      />,
    );
    expect(screen.getByText(/usual/)).toBeInTheDocument();
  });
});
