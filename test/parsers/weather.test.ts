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

  it('converts visibility reported in miles to feet, if the cell text ever says "mi" instead of "ft"', () => {
    // The real Teton Pass page always reports visibility in feet (see
    // sensors-tetonpass.html), but visibilityFt is a typed feet contract --
    // a future page reshape reporting miles instead must not silently be
    // stored 5280x too small.
    const html = `
      <table><tbody>
        <tr><td><font size="-1">Visibility</font></td><td><font size="-1">1.5 mi (2.4 km)</font></td></tr>
      </tbody></table>`;
    expect(parseSensorPage(html)?.visibilityFt).toBe(1.5 * 5280);
  });

  it('a duplicate sensor-group label (e.g. two Air temperature rows): the FIRST occurrence wins, deterministically', () => {
    // The real Teton Pass page never has duplicate labels, but the brief
    // flags multi-group pages as a real possibility on other stations --
    // this locks in a deterministic rule rather than "whichever happens to
    // parse last wins".
    const html = `
      <table><tbody>
        <tr><td><font size="-1">Air temperature</font></td><td><font size="-1">70&#176F (21&#176C)</font></td></tr>
        <tr><td><font size="-1">Air temperature</font></td><td><font size="-1">10&#176F (-12&#176C)</font></td></tr>
      </tbody></table>`;
    expect(parseSensorPage(html)?.airF).toBe(70);
  });
});

describe('parseSensorPage — humidity and dew point', () => {
  it('extracts relative humidity as a percentage', () => {
    const r = parseSensorPage(load('sensors-tetonpass.html'));
    expect(r?.humidityPct).toBe(34);
  });

  it('extracts dew point in Fahrenheit, taking the US unit not the parenthesized metric', () => {
    // Cell reads "41°F (5°C)" -- the first number is the one we want.
    const r = parseSensorPage(load('sensors-tetonpass.html'));
    expect(r?.dewPointF).toBe(41);
  });

  it('ignores the stale commented-out value that precedes each real cell', () => {
    // The real dew point cell is preceded by <!--<td>32°F</td>-->. A parser
    // that stopped stripping comments would return 32 here.
    const r = parseSensorPage(load('sensors-tetonpass.html'));
    expect(r?.dewPointF).not.toBe(32);
  });

  // OBSERVED IN PRODUCTION 2026-08-15: WYDOT's humidity instrument failed
  // and the page served the literal text "NaN%" in that cell, while every
  // other sensor kept reporting normally. Derived from the live fixture by
  // swapping only that one cell, following the same convention
  // poller.test.ts uses for derived fixtures rather than adding a
  // near-duplicate file.
  it('a humidity cell reading "NaN%" yields null, and does not poison the other sensors', () => {
    const html = load('sensors-tetonpass.html').replace(
      '<font size="-1">34%</font>',
      '<font size="-1">NaN%</font>',
    );
    const reading = parseSensorPage(html)!;

    // No digits to extract, so the reading is absent -- not 0, which would
    // assert a measured humidity of zero percent.
    expect(reading.humidityPct).toBeNull();

    // The real failure mode this guards: one unparseable cell taking the
    // whole reading down with it. Every other sensor must survive.
    expect(reading.airF).toBe(70);
    expect(reading.surfaceF).not.toBeNull();
    expect(reading.dewPointF).toBe(41);
    expect(reading.windGustMph).not.toBeNull();
    expect(reading.visibilityFt).not.toBeNull();
    expect(reading.reportedAt).not.toBeNull();
  });
});
