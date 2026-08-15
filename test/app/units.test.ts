import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { fToC, formatTemp, useTempUnit } from '../../src/app/units';

afterEach(() => {
  // Restore the real localStorage BEFORE clearing it: the "unavailable"
  // test below stubs localStorage with an object that has no `clear`
  // method, so calling clear() first (while that stub is still the active
  // global) throws during cleanup itself.
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('fToC', () => {
  it('converts freezing and boiling exactly', () => {
    expect(fToC(32)).toBe(0);
    expect(fToC(212)).toBe(100);
  });

  it('handles temperatures below zero Fahrenheit', () => {
    // -40 is the one point where the scales agree.
    expect(fToC(-40)).toBe(-40);
  });
});

describe('formatTemp', () => {
  it('rounds to a whole degree in both units', () => {
    expect(formatTemp(50, 'F')).toBe('50°F');
    expect(formatTemp(50, 'C')).toBe('10°C'); // 10.0
    expect(formatTemp(70, 'C')).toBe('21°C'); // 21.1 rounds down
  });
});

describe('useTempUnit', () => {
  it('defaults to Fahrenheit', () => {
    const { result } = renderHook(() => useTempUnit());
    expect(result.current.unit).toBe('F');
  });

  it('persists the choice across a remount', () => {
    const first = renderHook(() => useTempUnit());
    act(() => first.result.current.setUnit('C'));
    first.unmount();

    const second = renderHook(() => useTempUnit());
    expect(second.result.current.unit).toBe('C');
  });

  it('degrades to the default instead of throwing when localStorage is unavailable', () => {
    // Private browsing / disabled storage. Same failure mode deviceId.ts
    // already guards against -- a unit preference must never crash a page.
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    });
    const { result } = renderHook(() => useTempUnit());
    expect(result.current.unit).toBe('F');
    expect(() => act(() => result.current.setUnit('C'))).not.toThrow();
  });
});
