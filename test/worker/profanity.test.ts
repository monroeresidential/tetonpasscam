import { describe, expect, it } from 'vitest';

import { containsProfanity } from '../../src/worker/profanity';

// SECURITY (Loupe finding #37, CWE-176). containsProfanity lowercased its
// input but never Unicode-normalized it, so the filter -- the anti-abuse
// control on POST /api/alerts -- was defeated by the simplest obfuscation:
// a zero-width space inside a banned word, or the fullwidth compatibility
// letters, which toLowerCase leaves untouched.
describe('containsProfanity — unicode obfuscation', () => {
  it('still matches the plain spelling', () => {
    expect(containsProfanity('this road is fucked up')).toBe(true);
  });

  it('matches a banned word split by a zero-width space', () => {
    expect(containsProfanity('this road is fu​cked up')).toBe(true);
  });

  it('matches fullwidth-lookalike letters', () => {
    expect(containsProfanity('ｓｈｉｔ conditions today')).toBe(true);
  });

  it('matches a word split by a soft hyphen', () => {
    // Same class of invisible separator as the zero-width family.
    expect(containsProfanity('this road is fu­cked up')).toBe(true);
  });

  it('does not flag an ordinary road report', () => {
    // The filter guards a public community feed; a false positive silently
    // drops a legitimate hazard report, which is worse than it sounds.
    expect(containsProfanity('Slick spots near the summit, take it slow')).toBe(false);
    expect(containsProfanity('Scraping and sanding crew working westbound')).toBe(false);
  });
});
