/** ~30-word lowercase profanity list applied to the `POST /api/alerts` `note`
 *  field. Deliberately blunt substring matching per the brief: the note is
 *  lowercased (normalized) and rejected if ANY listed word appears anywhere
 *  in it, including as a substring of a longer word. That's a known
 *  false-positive tradeoff (e.g. a benign word containing a banned
 *  substring) accepted here for simplicity -- `note` is an optional,
 *  140-char-capped field, not free-form content that needs nuanced
 *  moderation. `crap` and `arse` are carved out into
 *  `WORD_BOUNDED_PROFANITY_WORDS` below rather than living here, since their
 *  false-positive rate against ordinary words ('scrap', 'coarse', 'sparse')
 *  was high enough to be worth the extra precision; every other entry keeps
 *  the blunt substring tradeoff. */
const PROFANITY_WORDS: readonly string[] = [
  'fuck',
  'shit',
  'bitch',
  'asshole',
  'bastard',
  'cunt',
  'dick',
  'piss',
  'damn',
  'slut',
  'whore',
  'fag',
  'faggot',
  'nigger',
  'nigga',
  'retard',
  'cock',
  'pussy',
  'twat',
  'wanker',
  'douche',
  'motherfucker',
  'dumbass',
  'jackass',
  'bollocks',
  'bugger',
  'prick',
  'skank',
];

/** Matched only as a whole token (via a `\b`-bounded regex), not as a blunt
 *  substring -- see the note on `PROFANITY_WORDS` above for why these two
 *  are singled out. */
const WORD_BOUNDED_PROFANITY_WORDS: readonly string[] = ['crap', 'arse'];
const wordBoundedPatterns = WORD_BOUNDED_PROFANITY_WORDS.map((word) => new RegExp(`\\b${word}\\b`));

/** Invisible characters that carry no meaning in a road report but split a
 *  banned word in two for a plain substring match: the zero-width family
 *  (space / non-joiner / joiner), the byte-order mark, and the soft hyphen. */
const INVISIBLE_SEPARATORS = /[\u200B-\u200D\uFEFF\u00AD]/g;

/**
 * Fold away the obfuscations that defeat a plain substring match.
 *
 * `toLowerCase()` alone used to be the whole of this: an attacker defeated
 * the filter by typing `fu​cked` (zero-width space inside the word) or
 * by spelling it with fullwidth compatibility letters, which lowercasing
 * leaves untouched. NFKC folds the compatibility forms down to ASCII, and
 * stripping the invisibles closes the separator trick.
 *
 * NOT handled: homoglyphs. Cyrillic 'а' (U+0430) is a genuinely distinct
 * character from Latin 'a', and NFKC will not touch it -- catching those
 * needs a confusables map, which is a much larger change and carries real
 * false-positive risk on a public feed. This function is a speed bump
 * against casual obfuscation, not a guarantee, and the moderation story
 * should not assume otherwise.
 */
function foldForMatching(text: string): string {
  return text.normalize('NFKC').replace(INVISIBLE_SEPARATORS, '').toLowerCase();
}

/** True if `text`, once folded by `foldForMatching` (NFKC + invisibles
 *  stripped + lowercased), contains any listed word -- `PROFANITY_WORDS`
 *  entries as a substring anywhere, `WORD_BOUNDED_PROFANITY_WORDS` entries
 *  only as a whole token. */
export function containsProfanity(text: string): boolean {
  const normalized = foldForMatching(text);
  if (PROFANITY_WORDS.some((word) => normalized.includes(word))) return true;
  return wordBoundedPatterns.some((pattern) => pattern.test(normalized));
}
