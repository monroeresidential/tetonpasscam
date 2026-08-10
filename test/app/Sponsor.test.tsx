import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import Sponsor from '../../src/app/components/Sponsor';

describe('Sponsor', () => {
  it('renders the exact sponsor copy and UTM link', () => {
    render(<Sponsor />);
    const section = screen.getByLabelText('Sponsor');
    expect(section.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'Sponsored by Teton Flats — modern 1 & 2 bed apartments in Victor, 35 minutes from Jackson. Live here, check this page less.',
    );

    const link = screen.getByRole('link', { name: 'Teton Flats' });
    expect(link).toHaveAttribute(
      'href',
      'https://tetonflats.com/?utm_source=tetonpasscam&utm_medium=referral&utm_campaign=sponsor',
    );
  });

  it('styles the "Sponsored by Teton Flats" label as an uppercase sponsor-label tag', () => {
    render(<Sponsor />);
    const label = screen.getByText(
      (_content, element) => /sponsored by teton flats/i.test(element?.textContent ?? ''),
      { selector: 'p' },
    );
    expect(label.className).toMatch(/\buppercase\b/);
    expect(label.className).toMatch(/\btracking-wide\b/);
    expect(label.className).toMatch(/\btext-sponsor-label\b/);
    expect(label.className).toContain('text-[10.5px]');
  });
});
