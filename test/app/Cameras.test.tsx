import { fireEvent, render, screen } from '@testing-library/react';
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

  it('renders 3 lazy-loaded images with captions linking to Wyoming 511', () => {
    render(<Cameras />);
    const images = screen.getAllByRole('img');
    expect(images).toHaveLength(3);
    for (const img of images) {
      expect(img).toHaveAttribute('loading', 'lazy');
    }
    expect(screen.getByText('Jackson Hole Valley')).toBeInTheDocument();
    expect(screen.getByText('Teton Pass — East')).toBeInTheDocument();
    expect(screen.getByText('Teton Pass — West')).toBeInTheDocument();

    const links = screen.getAllByRole('link', { name: /wyoming 511/i });
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link).toHaveAttribute('href', 'https://www.wyoroad.info');
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
});
