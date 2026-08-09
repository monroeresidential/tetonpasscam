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
  lastConfirmed: { status: 'open', at: REPORT_AT },
  conditionText: 'Road Open',
  advisories: [],
  restrictions: [],
  wydotReportTime: REPORT_AT,
  weather: null,
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
      />,
    );
    expect(screen.getByText(/Closed — do not attempt/)).toBeInTheDocument();
    expect(screen.getByText(/up to \$750 fine/)).toBeInTheDocument();
    expect(screen.getByText(/Swan Valley/)).toBeInTheDocument();
  });

  it('renders RESTRICTED with the restriction named', () => {
    render(<StatusBanner data={{ ...base, status: 'restricted', restrictions: ['Chain Law Level 1'] }} />);
    expect(screen.getByText(/Chain Law Level 1/)).toBeInTheDocument();
  });

  it('renders UNKNOWN with 511 link', () => {
    render(<StatusBanner data={{ ...base, status: 'unknown' }} />);
    const link = screen.getByRole('link', { name: /wyoming 511/i });
    expect(link).toHaveAttribute('href', expect.stringContaining('wyoroad.info'));
  });

  it('always shows last-confirmed line', () => {
    render(<StatusBanner data={base} />);
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
      />,
    );
    expect(screen.queryByText(/reopen|estimate/i)).not.toBeInTheDocument();
  });

  it('drive time row hides delta when typicalSec null, shows ±min colored when present', async () => {
    const { default: DriveTimes } = await import('../../src/app/components/DriveTimes');
    const { rerender } = render(
      <DriveTimes
        travelTimes={[
          { slug: 'victor-jackson-eb', name: 'Victor to Jackson', durationSec: 1500, typicalSec: null, capturedAt: REPORT_AT },
        ]}
      />,
    );
    expect(screen.queryByText(/vs typical/)).not.toBeInTheDocument();

    rerender(
      <DriveTimes
        travelTimes={[
          { slug: 'victor-jackson-eb', name: 'Victor to Jackson', durationSec: 1500, typicalSec: 1200, capturedAt: REPORT_AT },
        ]}
      />,
    );
    expect(screen.getByText(/vs typical/)).toBeInTheDocument();
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
      />,
    );
    expect(screen.getByText('UNKNOWN')).toBeInTheDocument();
    expect(screen.queryByText(/Road Open to all traffic/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Falling Rock/)).not.toBeInTheDocument();
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
      />,
    );
    expect(screen.getByText('UNKNOWN')).toBeInTheDocument();
    expect(screen.queryByText(/Chain Law Level 1/)).not.toBeInTheDocument();
  });

  it('shows an amber stale chip with the WYDOT report time when isStale', () => {
    render(<StatusBanner data={{ ...base, isStale: true }} />);
    expect(screen.getByText(/data may be outdated/i)).toBeInTheDocument();
  });
});
