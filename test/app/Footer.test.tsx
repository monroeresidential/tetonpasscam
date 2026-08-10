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

  it('links to Wyoming 511, Idaho 511, START bus, 511 Notify, and the privacy policy', () => {
    render(<Footer />);
    expect(screen.getByRole('link', { name: /wyoming 511/i })).toHaveAttribute(
      'href',
      'https://www.wyoroad.info',
    );
    expect(screen.getByRole('link', { name: /idaho 511/i })).toHaveAttribute(
      'href',
      'https://511.idaho.gov',
    );
    expect(screen.getByRole('link', { name: /start/i })).toHaveAttribute(
      'href',
      'https://www.startbus.com',
    );
    expect(screen.getByRole('link', { name: /511 notify/i })).toHaveAttribute(
      'href',
      'https://511notify.wyoroad.info',
    );
    expect(screen.getByRole('link', { name: /privacy/i })).toHaveAttribute('href', '/privacy.html');
  });

  it('shows the "Not affiliated with WYDOT" disclaimer', () => {
    render(<Footer />);
    expect(screen.getByText(/not affiliated with wydot/i)).toBeInTheDocument();
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
