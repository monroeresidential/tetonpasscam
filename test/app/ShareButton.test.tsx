import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import ShareButton, { buildShareUrl } from '../../src/app/components/ShareButton';

const CODE = '20260810-1412';

describe('buildShareUrl', () => {
  it('eb (default direction) has no query param', () => {
    const url = buildShareUrl(CODE, 'eb');
    expect(url).toBe(`${window.location.origin}/s/${CODE}`);
  });

  it('wb direction appends ?dir=wb', () => {
    const url = buildShareUrl(CODE, 'wb');
    expect(url).toBe(`${window.location.origin}/s/${CODE}?dir=wb`);
  });
});

describe('ShareButton', () => {
  it('renders nothing when shareCode is null (pollerDead/no snapshot)', () => {
    render(<ShareButton shareCode={null} direction="eb" />);
    expect(screen.queryByRole('button', { name: /share current conditions/i })).not.toBeInTheDocument();
  });

  it('renders an accessible share control when a share code is present', () => {
    render(<ShareButton shareCode={CODE} direction="eb" />);
    expect(screen.getByRole('button', { name: /share current conditions/i })).toBeInTheDocument();
  });

  // Option 3a restyle: a white pill (rounded-full, white bg, shadow) rather
  // than the old text-link styling.
  it('renders as a white pill with the default ink tone when toneClass is omitted', () => {
    render(<ShareButton shareCode={CODE} direction="eb" />);
    const button = screen.getByRole('button', { name: /share current conditions/i });
    expect(button.className).toMatch(/rounded-full/);
    expect(button.className).toMatch(/bg-white/);
    expect(button.className).toMatch(/shadow-md/);
    expect(button.className).toMatch(/text-ink/);
  });

  it('applies a caller-supplied toneClass to the pill text color', () => {
    render(<ShareButton shareCode={CODE} direction="eb" toneClass="text-status-closed" />);
    const button = screen.getByRole('button', { name: /share current conditions/i });
    expect(button.className).toMatch(/text-status-closed/);
    expect(button.className).not.toMatch(/text-ink/);
  });

  it('does not render a share sheet before the pill is clicked', () => {
    render(<ShareButton shareCode={CODE} direction="eb" />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('clicking the pill opens the share preview sheet instead of calling navigator.share directly', async () => {
    const user = userEvent.setup();
    render(<ShareButton shareCode={CODE} direction="eb" />);

    await user.click(screen.getByRole('button', { name: /share current conditions/i }));

    expect(screen.getByRole('dialog', { name: /share current conditions/i })).toBeInTheDocument();
  });

  it('closing the sheet (Escape) returns focus to the pill', async () => {
    const user = userEvent.setup();
    render(<ShareButton shareCode={CODE} direction="eb" />);

    const pill = screen.getByRole('button', { name: /share current conditions/i });
    await user.click(pill);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(pill).toHaveFocus();
  });
});
