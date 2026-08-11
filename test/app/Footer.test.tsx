import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Footer from '../../src/app/components/Footer';

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe('Footer', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('links to the privacy policy, Wyoming 511, Idaho 511, 511 Notify, and embed', () => {
    render(<Footer />);
    expect(screen.getByRole('link', { name: 'Privacy policy' })).toHaveAttribute(
      'href',
      '/privacy',
    );
    expect(screen.getByRole('link', { name: 'Wyoming 511' })).toHaveAttribute(
      'href',
      'https://www.wyoroad.info',
    );
    expect(screen.getByRole('link', { name: 'Idaho 511' })).toHaveAttribute(
      'href',
      'https://511.idaho.gov',
    );
    expect(screen.getByRole('link', { name: '511 Notify' })).toHaveAttribute(
      'href',
      'https://511notify.wyoroad.info',
    );
    expect(screen.getByRole('link', { name: 'Embed Site' })).toHaveAttribute('href', '/embed');
    expect(screen.queryByRole('link', { name: /start bus/i })).toBeNull();
  });

  it('shows the "Not affiliated with WYDOT" disclaimer', () => {
    render(<Footer />);
    expect(screen.getByText(/not affiliated with wydot/i)).toBeInTheDocument();
  });

  it('arranges the six footer controls as a single dot-separated wrapping line, in order', () => {
    render(<Footer />);
    const nav = screen.getByRole('navigation', { name: 'Footer' });
    expect(nav.className).toMatch(/\bflex\b/);
    expect(nav.className).toMatch(/\bflex-wrap\b/);
    expect(nav.className).not.toMatch(/\bgrid-cols-2\b/);

    const controls = Array.from(nav.querySelectorAll('a, button'));
    expect(controls.map((el) => el.textContent)).toEqual([
      'Privacy policy',
      'Wyoming 511',
      'Idaho 511',
      '511 Notify',
      'Embed Site',
      'Feedback',
    ]);
  });

  it('opens a feedback mini-modal that posts to /api/feedback', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(jsonResponse(201, { ok: true }));

    const user = userEvent.setup();
    render(<Footer />);
    await user.click(screen.getByRole('button', { name: /feedback/i }));

    expect(
      screen.getByRole('heading', { name: "Tell us what's broken (or what you'd love)" }),
    ).toBeInTheDocument();
    expect(screen.getByText('Goes straight to a human in Teton Valley.')).toBeInTheDocument();

    const textbox = screen.getByRole('textbox', { name: /feedback/i });
    await user.type(textbox, 'Love the site!');
    await user.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/feedback');
    const body = JSON.parse(init.body as string);
    expect(body.body).toBe('Love the site!');
  });
});
