import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import Sponsor from '../../src/app/components/Sponsor';

describe('Sponsor', () => {
  // Card redesign (Drew-requested): new copy replaces the old byte-frozen
  // strings -- Drew is changing his own sponsor text, so this pin moves to
  // the new exact wording rather than staying byte-frozen forever.
  it('renders the exact sponsor copy and UTM links', () => {
    render(<Sponsor />);
    const section = screen.getByLabelText('Sponsor');
    expect(section.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'Created by Teton Flats — 1 & 2 bed apartments in Victor, 35 minutes from Jackson, save thousands in rent.',
    );

    const labelLink = screen.getByRole('link', { name: 'Teton Flats' });
    expect(labelLink).toHaveAttribute(
      'href',
      'https://tetonflats.com/?utm_source=tetonpasscam&utm_medium=referral&utm_campaign=sponsor&utm_content=sponsor-label',
    );
    expect(labelLink).toHaveAttribute('rel', 'sponsored noopener');

    const imageLink = screen.getByRole('link', { name: /Teton Flats — 1 & 2/ });
    expect(imageLink).toHaveAttribute(
      'href',
      'https://tetonflats.com/?utm_source=tetonpasscam&utm_medium=referral&utm_campaign=sponsor&utm_content=sponsor-image',
    );
    expect(imageLink).toHaveAttribute('rel', 'sponsored noopener');
  });

  it('styles the "Created by Teton Flats" label as an uppercase sponsor-label tag', () => {
    render(<Sponsor />);
    const label = screen.getByText(
      (_content, element) => /created by teton flats/i.test(element?.textContent ?? ''),
      { selector: 'p' },
    );
    expect(label.className).toMatch(/\buppercase\b/);
    expect(label.className).toMatch(/\btracking-wide\b/);
    expect(label.className).toMatch(/\btext-sponsor-label\b/);
    expect(label.className).toContain('text-[10.5px]');
  });

  it('renders the apartment photo, far left, lazy-loaded with descriptive alt text, wrapped in a sponsor link', () => {
    render(<Sponsor />);
    const image = screen.getByRole('img', { name: 'Teton Flats apartment interior' });
    expect(image).toHaveAttribute('src', '/sponsor-tetonflats.jpg');
    expect(image).toHaveAttribute('loading', 'lazy');

    const imageLink = screen.getByRole('link', { name: /Teton Flats — 1 & 2/ });
    expect(imageLink).toContainElement(image);
  });

  it('lays the card out as image-left, text-right (horizontal flex)', () => {
    const { container } = render(<Sponsor />);
    const card = container.querySelector('.bg-sponsor-bg');
    expect(card).not.toBeNull();
    expect(card?.className).toMatch(/\bflex\b/);

    const imageLink = screen.getByRole('link', { name: /Teton Flats — 1 & 2/ });
    // The image link must be the flex container's first element child so it
    // renders on the left, with the label+body text block following it.
    expect(card?.firstElementChild).toBe(imageLink);
  });
});
