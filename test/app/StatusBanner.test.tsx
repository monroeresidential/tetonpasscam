import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import StatusBanner from '../../src/app/components/StatusBanner';
import type { ApiStatus } from '../../src/shared/types';

// 2026-08-09T23:48:00.000Z is 5:48 PM America/Denver (MDT, UTC-6 in August)
// -- matches the spec's own example copy ("last confirmed open 5:48 PM"),
// used deliberately so assertions below read the same way the spec does.
const REPORT_AT = '2026-08-09T23:48:00.000Z';

const base: ApiStatus = {
  status: 'open',
  isStale: false,
  pollerDead: false,
  generatedAt: REPORT_AT,
  shareCode: '20260810-1200',
  lastConfirmed: { status: 'open', at: REPORT_AT },
  conditionText: 'Road Open',
  advisories: [],
  restrictions: [],
  wydotReportTime: REPORT_AT,
  weather: null,
  weatherStale: false,
  travelTimes: [],
  id33Advisory: null,
  detours: null,
  alerts: [],
};

describe('StatusBanner', () => {
  it('renders CLOSED with legal copy and detour block', () => {
    render(
      <StatusBanner
        data={{
          ...base,
          status: 'closed',
          detours: [{ route: 'US26', conditionText: 'Wet' }],
        }}
        direction="eb"
      />,
    );
    // Hard rule #5's substance, asserted on the banner's new two-part shape:
    // the headline states the state, the line under it states the
    // instruction. "do not attempt" and a stated penalty must both survive
    // any future copy edit.
    expect(screen.getByTestId('banner-headline')).toHaveTextContent('Closed');
    expect(screen.getByText(/do not attempt/i)).toBeInTheDocument();
    expect(screen.getByText(/\$750/)).toBeInTheDocument();
    expect(screen.getByText(/Swan Valley/)).toBeInTheDocument();
  });

  it('renders RESTRICTED with the restriction named', () => {
    render(
      <StatusBanner
        data={{ ...base, status: 'restricted', restrictions: ['Chain Law Level 1'] }}
        direction="eb"
      />,
    );
    expect(screen.getByText(/Chain Law Level 1/)).toBeInTheDocument();
  });

  it('renders UNKNOWN with 511 link', () => {
    render(<StatusBanner data={{ ...base, status: 'unknown' }} direction="eb" />);
    const link = screen.getByRole('link', { name: /wyoming 511/i });
    expect(link).toHaveAttribute(
      'href',
      'https://www.wyoroad.info/highway/conditions/RoadClosures.html',
    );
  });

  it('always shows last-confirmed line', () => {
    render(<StatusBanner data={base} direction="eb" />);
    // Both the WYDOT-report line and the last-confirmed line legitimately
    // contain "5:48 PM" in this fixture -- scope the time assertion to the
    // last-confirmed element specifically rather than matching it globally.
    const confirmedLine = screen.getByText(/last confirmed open/i);
    expect(confirmedLine).toBeInTheDocument();
    expect(confirmedLine).toHaveTextContent(/5:48\s*PM/);
  });

  it('never renders a reopening estimate element', () => {
    render(
      <StatusBanner
        data={{
          ...base,
          status: 'closed',
          detours: [{ route: 'US26', conditionText: 'Wet' }],
        }}
        direction="eb"
      />,
    );
    expect(screen.queryByText(/reopen|estimate/i)).not.toBeInTheDocument();
  });

  // Cross-task safety flag from Task 9's review: pollerDead must force the
  // UNKNOWN presentation, and the API's last-known conditionText/advisories/
  // restrictions must NEVER be rendered as if they describe the CURRENT
  // status -- those fields are stale-but-present in the payload even while
  // dead. They may only ever appear inside the clearly-labeled
  // last-confirmed context.
  it('pollerDead forces UNKNOWN presentation and never renders stale conditionText as current', () => {
    render(
      <StatusBanner
        data={{
          ...base,
          status: 'open',
          pollerDead: true,
          conditionText: 'Road Open to all traffic',
          advisories: ['Falling Rock'],
          restrictions: [],
        }}
        direction="eb"
      />,
    );
    expect(screen.getByText('UNKNOWN')).toBeInTheDocument();
    expect(screen.queryByText(/Road Open to all traffic/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Falling Rock/)).not.toBeInTheDocument();
  });

  // The advisory pills lowercase their text (`Advisory: falling rock
  // (standing)`), so the frozen assertion above -- which only checks the
  // original-cased `/Falling Rock/` -- can never catch a leak of the
  // lowercased pill. Cover that gap with a case-insensitive check plus a
  // check for the pill's own leading label, without touching the frozen
  // test's byte-exact assertions.
  it('pollerDead never renders the stale advisory as a "standing" pill (case-insensitive)', () => {
    render(
      <StatusBanner
        data={{
          ...base,
          status: 'open',
          pollerDead: true,
          advisories: ['Falling Rock'],
        }}
        direction="eb"
      />,
    );
    expect(screen.queryByText(/falling rock/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Advisory:/)).not.toBeInTheDocument();
  });

  // Same safety flag, but for `restrictions` specifically: the binding
  // constraint names conditionText/advisories/restrictions together, so a
  // dead poller with a stale 'restricted' snapshot must not leak the old
  // restriction text either.
  it('pollerDead with a stale RESTRICTED snapshot never renders the old restriction text', () => {
    render(
      <StatusBanner
        data={{
          ...base,
          status: 'restricted',
          pollerDead: true,
          restrictions: ['Chain Law Level 1'],
        }}
        direction="eb"
      />,
    );
    expect(screen.getByText('UNKNOWN')).toBeInTheDocument();
    expect(screen.queryByText(/Chain Law Level 1/)).not.toBeInTheDocument();
  });

  it('shows an amber stale chip with the WYDOT report time when isStale', () => {
    render(<StatusBanner data={{ ...base, isStale: true }} direction="eb" />);
    expect(screen.getByText(/data may be outdated/i)).toBeInTheDocument();
  });

  // Each of these four targets `banner-headline` specifically (rather than
  // the whole container's flattened text) so the assertion can't be
  // satisfied by some other element -- e.g. deleting the CLOSED headline
  // entirely would still leave the byte-frozen legal `<p>` alone to satisfy
  // a container-wide substring check, silently losing headline coverage.
  it('OPEN headline reads "The pass is OPEN"', () => {
    render(<StatusBanner data={base} direction="eb" />);
    expect(screen.getByTestId('banner-headline')).toHaveTextContent('The pass is OPEN');
  });

  it('RESTRICTED headline leads with the first restriction', () => {
    render(
      <StatusBanner
        data={{
          ...base,
          status: 'restricted',
          restrictions: ['Chain Law Level 1', 'High-profile vehicles'],
        }}
        direction="eb"
      />,
    );
    expect(screen.getByTestId('banner-headline')).toHaveTextContent(
      'RESTRICTED — Chain Law Level 1',
    );
  });

  it('UNKNOWN headline reads "UNKNOWN — check Wyoming 511"', () => {
    render(<StatusBanner data={{ ...base, status: 'unknown' }} direction="eb" />);
    expect(screen.getByTestId('banner-headline')).toHaveTextContent(
      'UNKNOWN — check Wyoming 511',
    );
  });

  // The banner headline used to carry the whole legal sentence, which then
  // repeated verbatim in the line below it -- "Closed — do not attempt"
  // printed twice within two lines, the headline wrapping across four lines
  // of 40px type on a phone (screenshots, 2026-08-18). The headline is now
  // one word and the warning is stated once, beneath it.
  //
  // Pinned to the exact strings on purpose: this is the state with legal
  // exposure, so a copy edit here should have to be deliberate. The
  // self-contained sentence still exists for the surfaces that have no
  // headline of their own -- see the seo-inject and card-render suites, which
  // assert CLOSED_LEGAL_COPY unchanged.
  it('CLOSED headline states only the state; the warning below states the instruction, once', () => {
    const { container } = render(
      <StatusBanner data={{ ...base, status: 'closed' }} direction="eb" />,
    );
    expect(screen.getByTestId('banner-headline')).toHaveTextContent('Closed');
    expect(container.textContent).toContain(
      'Do not attempt. A closed Wyoming road is illegal — up to $750.',
    );
    // Said once, not twice: the old duplication is what this guards against.
    expect(container.textContent!.match(/do not attempt/gi)).toHaveLength(1);
  });

  it('renders a standing advisory as an "Advisory: ... (standing)" pill', () => {
    render(<StatusBanner data={{ ...base, advisories: ['Falling Rock'] }} direction="eb" />);
    expect(screen.getByText('Advisory: falling rock (standing)')).toBeInTheDocument();
  });

  it('last-confirmed line uses the "<status> <time> · WYDOT" format', () => {
    render(<StatusBanner data={base} direction="eb" />);
    expect(screen.getByText('Last confirmed open 5:48 PM · WYDOT')).toBeInTheDocument();
  });

  // Regression pin (design call): the sub-line used to render at opacity-90;
  // that's been removed so the "Last confirmed..." meta reads at full
  // opacity like the rest of the banner.
  it('renders the last-confirmed sub-line at full opacity (no opacity-90)', () => {
    render(<StatusBanner data={base} direction="eb" />);
    const line = screen.getByText('Last confirmed open 5:48 PM · WYDOT');
    expect(line.parentElement).not.toHaveClass('opacity-90');
  });

  // Option 3a: the Share pill lives on the banner itself now (top-right of
  // the headline row), not down in DriveTimes -- these three pin the same
  // withholding contract ShareButton.test.tsx already covers in isolation,
  // exercised here through StatusBanner's own wiring.
  describe('share pill', () => {
    it('renders the share pill when a share code is present', () => {
      render(<StatusBanner data={base} direction="eb" />);
      expect(screen.getByRole('button', { name: /share current conditions/i })).toBeInTheDocument();
    });

    it('omits the share pill when shareCode is null', () => {
      render(<StatusBanner data={{ ...base, shareCode: null }} direction="eb" />);
      expect(
        screen.queryByRole('button', { name: /share current conditions/i }),
      ).not.toBeInTheDocument();
    });

    it('omits the share pill when pollerDead, even with a shareCode set in the fixture', () => {
      render(<StatusBanner data={{ ...base, pollerDead: true }} direction="eb" />);
      expect(
        screen.queryByRole('button', { name: /share current conditions/i }),
      ).not.toBeInTheDocument();
    });
  });
});
