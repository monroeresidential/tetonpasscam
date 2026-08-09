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

/** True if `text`, lowercased, contains any listed word -- `PROFANITY_WORDS`
 *  entries as a substring anywhere, `WORD_BOUNDED_PROFANITY_WORDS` entries
 *  only as a whole token. */
export function containsProfanity(text: string): boolean {
  const normalized = text.toLowerCase();
  if (PROFANITY_WORDS.some((word) => normalized.includes(word))) return true;
  return wordBoundedPatterns.some((pattern) => pattern.test(normalized));
}
