import type { ThreadString } from '../parser/types';

const NOISE_PATTERNS: RegExp[] = [
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  /^(https?|rtsp|content|file):\/\//i,
  /^(image|video|audio|application|text)\/[a-z0-9+.-]+$/i,
  /^[A-Za-z0-9][\w.-]*\.(jpg|jpeg|png|gif|webp|mp4|3gp|zip|bin|dat)$/i,
  /^[0-9a-f]{16,}$/i,
  /^[A-Z][A-Z0-9_]{2,}$/,
  /^\d{10,}$/,
  // iOS/Android filesystem paths that leak into message bodies as internal
  // references — these contain real words ("Containers", "Application") so
  // must be rejected structurally, not by vocabulary.
  /\/(var|data|Users|Library|Application Support|Containers|sdcard|storage)\//,
  /\.(jpg|jpeg|png|gif|webp|mp4|3gp|zip|bin|dat|tmp)\b/i,
  // SIP/inbox metadata that leaks into thread-body string runs.
  /^text\/plain/i,
  /^sip:anonymous@anonymous\.invalid$/i,
  /^\|.*\|\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/,
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/,
];

const JAPANESE_RE = /[\u3040-\u30ff\u4e00-\u9fff\uff66-\uff9f]/;
const WORD_RE = /[A-Za-z]{4,}/g;
const VOWEL_RE = /[aeiouAEIOU]/;
// A well-formed English-ish word: all-lowercase, First-capital, or ALL-UPPER.
// Random binary bytes usually produce noisy mixed-case clusters (e.g. "vDkO",
// "OUuEMr") that don't match any of these.
const NORMAL_CASING_RE = /^(?:[a-z]+|[A-Z][a-z]+|[A-Z]+)$/;

// ASCII punctuation that almost never appears in real human messages but
// shows up constantly in random binary-decoded-as-UTF-8 noise.
const BINARY_NOISE_CHARS_RE = /[<>[\]{}\\^`|~]/;

/**
 * Longest run of consecutive Japanese codepoints. Real Japanese messages
 * string several kana/kanji together; random binary that happens to land in
 * a CJK byte range typically produces *isolated* single Japanese codepoints
 * surrounded by ASCII ("裾F*餔Vj籬jT熒n", "b,.鵰k.槊ĸ"). Requiring a run of
 * ≥2 cleanly rejects that noise without hurting real messages.
 */
function maxJapaneseRun(codepoints: readonly string[]): number {
  let max = 0;
  let current = 0;
  for (const ch of codepoints) {
    if (JAPANESE_RE.test(ch)) {
      current += 1;
      if (current > max) max = current;
    } else {
      current = 0;
    }
  }
  return max;
}

export function isLikelyMessageText(raw: string): boolean {
  const t = raw.trim();
  if (t.length < 2) return false;
  if (t.length > 500) return false;
  if (NOISE_PATTERNS.some((re) => re.test(t))) return false;

  const codepoints = [...t];
  const hasJapanese = codepoints.some((ch) => JAPANESE_RE.test(ch));

  if (hasJapanese) {
    if (BINARY_NOISE_CHARS_RE.test(t)) return false;
    // Need at least two Japanese codepoints next to each other. Stray
    // single kanji between ASCII is a strong noise signal.
    if (maxJapaneseRun(codepoints) < 2) return false;
    return true;
  }

  // ASCII-only path — needs word-like structure to separate signal from noise.
  const words = t.match(WORD_RE) ?? [];
  const realWords = words.filter((w) => VOWEL_RE.test(w) && NORMAL_CASING_RE.test(w));
  const hasLongWord = realWords.some((w) => w.length >= 6);
  const hasMultipleWords = realWords.length >= 2;
  if (!hasLongWord && !hasMultipleWords) return false;
  if (!/\s/.test(t)) return false;
  const symbols = (t.match(/[^A-Za-z0-9\s]/g) ?? []).length;
  if (symbols / t.length > 0.3) return false;
  return codepoints.length >= 6;
}

export function filterMessageStrings(strings: readonly ThreadString[]): ThreadString[] {
  return strings.filter((s) => isLikelyMessageText(s.text));
}
