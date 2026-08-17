import { describe, expect, it } from 'vitest';

import { WEATHER_GLYPH, WEATHER_GLYPH_NIGHT, glyphFor, precipGlyphFor } from '../../src/app/weatherGlyphs';
import type { ForecastCategory } from '../../src/shared/types';

const ALL: ForecastCategory[] = [
  'clear', 'partly-cloudy', 'cloudy', 'rain', 'snow', 'mixed', 'thunderstorm', 'fog',
];

describe('weatherGlyphs', () => {
  it('covers every category', () => {
    for (const c of ALL) expect(WEATHER_GLYPH[c]).toBeTruthy();
  });

  it('swaps to a night glyph only where a sun would be wrong', () => {
    expect(glyphFor('clear', false)).not.toBe(glyphFor('clear', true));
    expect(glyphFor('partly-cloudy', false)).not.toBe(glyphFor('partly-cloudy', true));
    // Precipitation and cloud look the same after dark.
    expect(glyphFor('snow', false)).toBe(glyphFor('snow', true));
    expect(glyphFor('rain', false)).toBe(glyphFor('rain', true));
  });

  it('gives every glyph emoji presentation, and no gratuitous selectors', () => {
    // Verified empirically with \p{Emoji_Presentation}: of our eight base
    // characters, ONLY U+26C5 (partly-cloudy) is emoji-by-default. The other
    // seven default to monochrome text and need U+FE0F, or the row renders
    // half flat-ink and half colour. U+26C5 must NOT carry one -- a selector
    // on an already-emoji character is noise that invites someone to
    // "consistently" add them everywhere and mask a real omission.
    for (const c of ALL) {
      const g = WEATHER_GLYPH[c];
      const base = String.fromCodePoint(g.codePointAt(0)!);
      const isEmojiByDefault = /\p{Emoji_Presentation}/u.test(base);
      const hasSelector = g.includes('️');
      expect(hasSelector, `${c} (${base})`).toBe(!isEmojiByDefault);
    }
  });

  it('applies the same rule to the night variants', () => {
    for (const g of Object.values(WEATHER_GLYPH_NIGHT)) {
      const base = String.fromCodePoint(g!.codePointAt(0)!);
      expect(g!.includes('️')).toBe(!/\p{Emoji_Presentation}/u.test(base));
    }
  });
});

describe('precipGlyphFor', () => {
  it('uses a snowflake for snow and a droplet for everything else', () => {
    expect(precipGlyphFor('snow')).toBe('❄️');
    expect(precipGlyphFor('rain')).toBe('💧');
    expect(precipGlyphFor('clear')).toBe('💧');
    expect(precipGlyphFor('thunderstorm')).toBe('💧');
  });

  it('treats mixed precipitation as snow -- the hazard, not the average', () => {
    // `mixed` is rain AND snow. On a mountain pass the snowflake is the
    // half a driver needs to see, matching the severity bias the daily
    // rollup's tie-break already applies.
    expect(precipGlyphFor('mixed')).toBe('❄️');
  });

  it('carries emoji presentation on both glyphs', () => {
    for (const g of [precipGlyphFor('snow'), precipGlyphFor('rain')]) {
      const base = String.fromCodePoint(g.codePointAt(0)!);
      expect(g.includes('️')).toBe(!/\p{Emoji_Presentation}/u.test(base));
    }
  });
});
