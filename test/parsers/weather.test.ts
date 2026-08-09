// REAL LAYOUT (captured 2026-08-09 from wyoroad.info
// Sensors.StationResults?SelectedStation=Teton+Pass): see test/fixtures/README.md
// for full detail and provenance.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseSensorPage } from '../../src/worker/poller/wydot-weather';

const load = (f: string) => readFileSync(`test/fixtures/${f}`, 'utf8');

describe('parseSensorPage', () => {
  it('parses the live fixture with numeric airF and surfaceF', () => {
    const r = parseSensorPage(load('sensors-tetonpass.html'));
    expect(r).not.toBeNull();
    expect(r?.airF).toBe(70);
    expect(r?.surfaceF).toBe(95);
  });

  it('parses wind, direction, and visibility (already in feet -- no mi conversion needed)', () => {
    const r = parseSensorPage(load('sensors-tetonpass.html'));
    expect(r?.windAvgMph).toBe(1.9);
    expect(r?.windGustMph).toBe(6.2);
    expect(r?.windDir).toBe('SW');
    expect(r?.visibilityFt).toBe(6562);
  });

  it('converts the Denver-local report timestamp to UTC ISO', () => {
    const r = parseSensorPage(load('sensors-tetonpass.html'));
    // Aug 9, 2026, 11:10 AM MDT === 17:10 UTC
    expect(r?.reportedAt).toBe('2026-08-09T17:10:00.000Z');
  });

  it('ignores the stale example values embedded in HTML comments ahead of each real cell', () => {
    // Each row's real value is preceded by a commented-out
    // <!--<td>...</td>--> holding a different, stale example number (e.g.
    // "25°F" before the real "70°F" air-temperature cell). A parser that
    // fails to strip comments before extracting cells would see 3 <td>-like
    // matches per row and could grab the wrong one.
    const r = parseSensorPage(load('sensors-tetonpass.html'));
    expect(r?.airF).not.toBe(25);
    expect(r?.surfaceF).not.toBe(30);
  });

  it('a single blanked value cell (Air temperature) comes back as a null FIELD, without failing the rest of the reading', () => {
    const r = parseSensorPage(load('sensors-tetonpass-blank-air.html'));
    expect(r).not.toBeNull();
    expect(r?.airF).toBeNull();
    expect(r?.surfaceF).toBe(95);
    expect(r?.windAvgMph).toBe(1.9);
    expect(r?.windGustMph).toBe(6.2);
    expect(r?.windDir).toBe('SW');
    expect(r?.visibilityFt).toBe(6562);
  });

  it('garbage/unrecognizable html ⇒ null (the whole reading, not just fields)', () => {
    expect(parseSensorPage('')).toBeNull();
    expect(parseSensorPage('<html><body>oops</body></html>')).toBeNull();
  });

  it('negative summit temperatures parse with their sign', () => {
    const html = load('sensors-tetonpass.html').replace('70&#176F (21&#176C)', '-5&#176F (-21&#176C)');
    const r = parseSensorPage(html);
    expect(r?.airF).toBe(-5);
  });
});
