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
});
