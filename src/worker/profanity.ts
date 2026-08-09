/** ~30-word lowercase profanity list applied to the `POST /api/alerts` `note`
 *  field. Deliberately blunt substring matching per the brief: the note is
 *  lowercased (normalized) and rejected if ANY listed word appears anywhere
 *  in it, including as a substring of a longer word. That's a known
 *  false-positive tradeoff (e.g. a benign word containing a banned
 *  substring) accepted here for simplicity -- `note` is an optional,
 *  140-char-capped field, not free-form content that needs nuanced
 *  moderation. */
const PROFANITY_WORDS: readonly string[] = [
  'fuck',
  'shit',
  'bitch',
  'asshole',
  'bastard',
  'cunt',
  'dick',
  'piss',
  'crap',
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
  'arse',
  'prick',
  'skank',
];

/** True if `text`, lowercased, contains any listed word as a substring. */
export function containsProfanity(text: string): boolean {
  const normalized = text.toLowerCase();
  return PROFANITY_WORDS.some((word) => normalized.includes(word));
}
