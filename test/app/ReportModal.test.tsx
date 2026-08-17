import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ReportModal from '../../src/app/components/ReportModal';

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe('ReportModal', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Regression pin (design call): the fixed pill on phone is now wrapped in
  // a fade container so it reads as an intentional soft landing rather than
  // a hard overlap of list content. The wrapper must stay pointer-events-none
  // so taps on content showing through the transparent top of the fade still
  // land -- only the pill itself (nested inside) re-enables pointer events.
  it('wraps the fixed pill in a pointer-events-none fade container', () => {
    render(<ReportModal />);
    const trigger = screen.getByRole('button', { name: /report conditions/i });
    const wrapper = screen.getByTestId('report-pill-fade');
    expect(wrapper).toHaveClass('pointer-events-none');
    expect(wrapper).toContainElement(trigger);
  });

  // Regression pin (review fix): `bg-gradient-to-t` here would put the
  // opaque `to-page` color at the TOP of the fade (a hard cut against
  // scrolling content) and transparent at the BOTTOM (a seam against the
  // solid button container) -- backwards from the intended soft landing.
  // Pins `to-b` so a future flip fails loudly instead of silently inverting.
  it('fades top-to-bottom (transparent at top, page color at bottom, not inverted)', () => {
    render(<ReportModal />);
    const gradient = screen.getByTestId('report-pill-fade-gradient');
    expect(gradient.className).toContain('bg-gradient-to-b');
    expect(gradient.className).toContain('to-page');
  });

  it('renders the sheet title and 7 emoji-labeled type buttons after opening', async () => {
    const user = userEvent.setup();
    render(<ReportModal />);
    await user.click(screen.getByRole('button', { name: /report conditions/i }));

    expect(screen.getByRole('heading', { name: 'What are you seeing?' })).toBeInTheDocument();

    for (const label of [
      '💥 Crash',
      '🛞 Slide-off',
      '❄ Slick/Ice',
      '🦌 Wildlife',
      '🚗 Stopped traffic',
      '🚧 Closure',
      '⚠ Other',
    ]) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  it('submits { type, note, direction, deviceId } plus an empty honeypot field', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(jsonResponse(201, { id: 1 }));

    const user = userEvent.setup();
    render(<ReportModal />);
    await user.click(screen.getByRole('button', { name: /report conditions/i }));
    await user.click(screen.getByRole('button', { name: '🦌 Wildlife' }));

    await user.type(screen.getByLabelText(/note/i), 'Elk on the road');
    await user.click(screen.getByRole('button', { name: 'EB → Jackson' }));
    await user.click(screen.getByRole('button', { name: /send report/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/alerts');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      type: 'wildlife',
      note: 'Elk on the road',
      direction: 'eb',
    });
    expect(typeof body.deviceId).toBe('string');
    expect(body.deviceId.length).toBeGreaterThan(0);
    expect(body.website).toBe('');
  });

  it('enforces maxLength=140 on the note field', async () => {
    const user = userEvent.setup();
    render(<ReportModal />);
    await user.click(screen.getByRole('button', { name: /report conditions/i }));
    await user.click(screen.getByRole('button', { name: '⚠ Other' }));

    const note = screen.getByLabelText(/note/i) as HTMLTextAreaElement;
    expect(note.maxLength).toBe(140);
  });

  it('fine print states reports do not change the official status', async () => {
    const user = userEvent.setup();
    render(<ReportModal />);
    await user.click(screen.getByRole('button', { name: /report conditions/i }));

    expect(screen.getByText(/does not change the official status/i)).toBeInTheDocument();
  });

  it('on success, closes the modal and shows a toast', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(jsonResponse(201, { id: 1 }));

    const user = userEvent.setup();
    render(<ReportModal />);
    await user.click(screen.getByRole('button', { name: /report conditions/i }));
    await user.click(screen.getByRole('button', { name: '🚧 Closure' }));
    await user.click(screen.getByRole('button', { name: /send report/i }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('status')).toHaveTextContent(/thanks|submitted/i);
  });

  it('on success, calls onSuccess (App wires this to an immediate /api/status refetch)', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(jsonResponse(201, { id: 1 }));
    const onSuccess = vi.fn();

    const user = userEvent.setup();
    render(<ReportModal onSuccess={onSuccess} />);
    await user.click(screen.getByRole('button', { name: /report conditions/i }));
    await user.click(screen.getByRole('button', { name: '💥 Crash' }));
    await user.click(screen.getByRole('button', { name: /send report/i }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
  });

  it('on a 429 response, shows "You\'re reporting too often" and keeps the modal open', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(jsonResponse(429, { error: 'rate limited' }));

    const user = userEvent.setup();
    render(<ReportModal />);
    await user.click(screen.getByRole('button', { name: /report conditions/i }));
    await user.click(screen.getByRole('button', { name: '❄ Slick/Ice' }));
    await user.click(screen.getByRole('button', { name: /send report/i }));

    await waitFor(() =>
      expect(screen.getByText("You're reporting too often")).toBeInTheDocument(),
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('locks body scroll while open and restores it on close', async () => {
    const { rerender } = render(<ReportModal open={false} onOpenChange={() => {}} onSuccess={() => {}} />);
    expect(document.body.style.overflow).toBe('');

    rerender(<ReportModal open onOpenChange={() => {}} onSuccess={() => {}} />);
    expect(document.body.style.overflow).toBe('hidden');

    rerender(<ReportModal open={false} onOpenChange={() => {}} onSuccess={() => {}} />);
    expect(document.body.style.overflow).toBe('');
  });

  it('restores body scroll on UNMOUNT, not only on close', () => {
    // App.tsx mounts this component's trigger conditionally on the desktop
    // breakpoint, so a resize can unmount it while open. A body left
    // `overflow: hidden` freezes the page with no visible cause.
    const { unmount } = render(<ReportModal open onOpenChange={() => {}} onSuccess={() => {}} />);
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).toBe('');
  });

  it('keeps the footer reachable by scrolling only the middle section', () => {
    render(<ReportModal open onOpenChange={() => {}} onSuccess={() => {}} />);
    const scroller = screen.getByTestId('sheet-scroll');
    expect(scroller).toHaveClass('overflow-y-auto');
    expect(scroller).toHaveClass('min-h-0');
    // The Send button lives outside the scroller, so it is always visible.
    expect(scroller).not.toContainElement(screen.getByRole('button', { name: /send/i }));
  });
});
