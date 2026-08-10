import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Cameras from '../../src/app/components/Cameras';

function tParam(src: string): string | null {
  return new URL(src, 'https://example.test').searchParams.get('t');
}

describe('Cameras', () => {
  beforeEach(() => {
    sessionStorage.clear();
    Object.defineProperty(navigator, 'sendBeacon', {
      value: vi.fn(),
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders 3 lazy-loaded images with captions', () => {
    render(<Cameras />);
    const images = screen.getAllByRole('img');
    expect(images).toHaveLength(3);
    for (const img of images) {
      expect(img).toHaveAttribute('loading', 'lazy');
    }
    expect(screen.getByText('Jackson Hole Valley')).toBeInTheDocument();
    expect(screen.getByText('Teton Pass — East')).toBeInTheDocument();
    expect(screen.getByText('Teton Pass — West')).toBeInTheDocument();
  });

  // Change 3: per-image "— Wyoming 511" links were removed from captions
  // (the single attribution line below the grid, and the onerror
  // fallback card's own link, both still carry a Wyoming 511 link -- this
  // test is scoped to the caption rows themselves, not those two).
  it('captions no longer contain per-image Wyoming 511 links', () => {
    render(<Cameras />);
    for (const figcaption of document.querySelectorAll('figcaption')) {
      expect(
        within(figcaption as HTMLElement).queryByRole('link', { name: /wyoming 511/i }),
      ).not.toBeInTheDocument();
    }
  });

  it('renders the WYDOT attribution line', () => {
    render(<Cameras />);
    expect(screen.getByText('Imagery: WYDOT Wyoming 511.')).toBeInTheDocument();
  });

  it('onerror swaps a camera image for a "View on Wyoming 511" link card', () => {
    render(<Cameras />);
    const images = screen.getAllByRole('img');
    fireEvent.error(images[0]);

    expect(screen.getAllByRole('img')).toHaveLength(2);
    expect(screen.getByRole('link', { name: /view on wyoming 511/i })).toBeInTheDocument();
  });

  it('beacons /api/camera-error at most once per camera per session', () => {
    render(<Cameras />);
    const images = screen.getAllByRole('img');
    fireEvent.error(images[0]);
    fireEvent.error(images[0]); // fired again after fallback wouldn't re-trigger, but guard anyway

    expect(navigator.sendBeacon).toHaveBeenCalledTimes(1);
    const [url, data] = (navigator.sendBeacon as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('/api/camera-error');
    const body = JSON.parse(data as string);
    expect(body).toEqual({ camera: 'valley' });
  });

  it('advancing the refreshedAt prop changes the img src\'s t cache-buster param', () => {
    const first = new Date('2026-08-09T18:00:00.000Z');
    const second = new Date('2026-08-09T18:02:00.000Z'); // one poll cycle later

    const { rerender } = render(<Cameras refreshedAt={first} />);
    const tsBefore = tParam(screen.getAllByRole('img')[0].getAttribute('src')!);
    expect(tsBefore).toBe(String(first.getTime()));

    rerender(<Cameras refreshedAt={second} />);
    const tsAfter = tParam(screen.getAllByRole('img')[0].getAttribute('src')!);
    expect(tsAfter).toBe(String(second.getTime()));
    expect(tsAfter).not.toBe(tsBefore);
  });

  it('does not beacon again for the same camera on a fresh render within the same session', () => {
    const { unmount } = render(<Cameras />);
    fireEvent.error(screen.getAllByRole('img')[0]);
    expect(navigator.sendBeacon).toHaveBeenCalledTimes(1);
    unmount();

    render(<Cameras />);
    fireEvent.error(screen.getAllByRole('img')[0]);
    expect(navigator.sendBeacon).toHaveBeenCalledTimes(1); // still 1 -- sessionStorage guard held
  });

  it('renders the "Cameras" section heading', () => {
    render(<Cameras />);
    expect(screen.getByRole('heading', { name: 'Cameras' })).toBeInTheDocument();
  });

  it('renders the valley camera first as a full-width hero, with east/west following as a 2-col grid', () => {
    render(<Cameras />);
    const images = screen.getAllByRole('img');
    expect(images[0]).toHaveAttribute('alt', 'Jackson Hole Valley');
    expect(images[1]).toHaveAttribute('alt', 'Teton Pass — East');
    expect(images[2]).toHaveAttribute('alt', 'Teton Pass — West');

    // Hero: full-width 16/8 aspect ratio; halves: aspect-video.
    expect(images[0].className).toMatch(/aspect-\[16\/8\]/);
    expect(images[1].className).toMatch(/aspect-video/);
    expect(images[2].className).toMatch(/aspect-video/);
  });

  it('shows a visible h:mm AM/PM timestamp next to each caption', () => {
    render(<Cameras refreshedAt={new Date('2026-08-09T18:00:00.000Z')} />);
    const timestamps = screen.getAllByText(/^\d{1,2}:\d{2}\s?(AM|PM)$/i);
    expect(timestamps).toHaveLength(3);
  });

  it('updates the visible timestamp text as the refreshedAt prop advances', () => {
    const first = new Date('2026-08-09T18:00:00.000Z');
    const second = new Date('2026-08-09T18:02:00.000Z');

    const { rerender } = render(<Cameras refreshedAt={first} />);
    const before = screen.getAllByText(/^\d{1,2}:\d{2}\s?(AM|PM)$/i)[0].textContent;

    rerender(<Cameras refreshedAt={second} />);
    const after = screen.getAllByText(/^\d{1,2}:\d{2}\s?(AM|PM)$/i)[0].textContent;

    expect(after).not.toBe(before);
  });

  it('does not render "Invalid Date" for the timestamp before refreshedAt has a value (mount-time fallback)', () => {
    render(<Cameras refreshedAt={null} />);
    expect(screen.queryByText(/invalid date/i)).not.toBeInTheDocument();
    expect(screen.getAllByText(/^\d{1,2}:\d{2}\s?(AM|PM)$/i)).toHaveLength(3);
  });

  describe('lightbox', () => {
    it('clicking a camera tile opens a dialog with the full-res image (incl. cache-buster) and caption', () => {
      render(<Cameras refreshedAt={new Date('2026-08-09T18:00:00.000Z')} />);
      fireEvent.click(screen.getByRole('button', { name: /view jackson hole valley full size/i }));

      const dialog = screen.getByRole('dialog');
      expect(dialog).toHaveAttribute('aria-modal', 'true');
      const images = within(dialog).getAllByRole('img');
      expect(images).toHaveLength(1);
      expect(images[0]).toHaveAttribute('alt', 'Jackson Hole Valley');
      expect(tParam(images[0].getAttribute('src')!)).toBe(String(new Date('2026-08-09T18:00:00.000Z').getTime()));
      expect(within(dialog).getByText('Jackson Hole Valley')).toBeInTheDocument();
    });

    it('Escape closes the lightbox', () => {
      render(<Cameras />);
      fireEvent.click(screen.getByRole('button', { name: /view jackson hole valley full size/i }));
      expect(screen.getByRole('dialog')).toBeInTheDocument();

      fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('the × close button closes the lightbox', () => {
      render(<Cameras />);
      fireEvent.click(screen.getByRole('button', { name: /view jackson hole valley full size/i }));
      fireEvent.click(screen.getByRole('button', { name: /^close$/i }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('backdrop click closes the lightbox', () => {
      render(<Cameras />);
      fireEvent.click(screen.getByRole('button', { name: /view jackson hole valley full size/i }));
      fireEvent.click(screen.getByRole('dialog'));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('clicking the image itself does not close the lightbox', () => {
      render(<Cameras />);
      fireEvent.click(screen.getByRole('button', { name: /view jackson hole valley full size/i }));
      const dialog = screen.getByRole('dialog');
      fireEvent.click(within(dialog).getByRole('img'));
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('ArrowRight cycles to the next camera, wrapping from last back to first', () => {
      render(<Cameras />);
      fireEvent.click(screen.getByRole('button', { name: /view teton pass — west full size/i }));
      expect(within(screen.getByRole('dialog')).getByText('Teton Pass — West')).toBeInTheDocument();

      fireEvent.keyDown(document, { key: 'ArrowRight' });
      expect(within(screen.getByRole('dialog')).getByText('Jackson Hole Valley')).toBeInTheDocument();
    });

    it('ArrowLeft cycles to the previous camera, wrapping from first back to last', () => {
      render(<Cameras />);
      fireEvent.click(screen.getByRole('button', { name: /view jackson hole valley full size/i }));

      fireEvent.keyDown(document, { key: 'ArrowLeft' });
      expect(within(screen.getByRole('dialog')).getByText('Teton Pass — West')).toBeInTheDocument();
    });

    it('prev/next arrow buttons navigate the carousel', () => {
      render(<Cameras />);
      fireEvent.click(screen.getByRole('button', { name: /view jackson hole valley full size/i }));

      fireEvent.click(screen.getByRole('button', { name: /next camera/i }));
      expect(within(screen.getByRole('dialog')).getByText('Teton Pass — East')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /previous camera/i }));
      fireEvent.click(screen.getByRole('button', { name: /previous camera/i }));
      expect(within(screen.getByRole('dialog')).getByText('Teton Pass — West')).toBeInTheDocument();
    });

    it('an errored camera tile falls back to the link card and cannot open the lightbox', () => {
      render(<Cameras />);
      fireEvent.error(screen.getAllByRole('img')[0]);
      expect(
        screen.queryByRole('button', { name: /view jackson hole valley full size/i }),
      ).not.toBeInTheDocument();
      expect(screen.getByRole('link', { name: /view on wyoming 511/i })).toBeInTheDocument();
    });

    it('locks body scroll while open and restores it on close', () => {
      render(<Cameras />);
      fireEvent.click(screen.getByRole('button', { name: /view jackson hole valley full size/i }));
      expect(document.body.style.overflow).toBe('hidden');

      fireEvent.keyDown(document, { key: 'Escape' });
      expect(document.body.style.overflow).not.toBe('hidden');
    });
  });
});
