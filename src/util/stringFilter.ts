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
];

const JAPANESE_RE = /[\u3040-\u30ff\u4e00-\u9fff\uff66-\uff9f]/;
const WORD_RE = /[A-Za-z]{4,}/g;
const VOWEL_RE = /[aeiouAEIOU]/;
// A well-formed English-ish word: all-lowercase, First-capital, or ALL-UPPER.
// Random binary bytes usually produce noisy mixed-case clusters (e.g. "vDkO",
// "OUuEMr") that don't match any of these.
const NORMAL_CASING_RE = /^(?:[a-z]+|[A-Z][a-z]+|[A-Z]+)$/;

export function isLikelyMessageText(raw: string): boolean {
  const t = raw.trim();
  if (t.length < 2) return false;
  if (t.length > 500) return false;
  if (NOISE_PATTERNS.some((re) => re.test(t))) return false;
  if (JAPANESE_RE.test(t)) return true;
  const words = t.match(WORD_RE) ?? [];
  const realWords = words.filter((w) => VOWEL_RE.test(w) && NORMAL_CASING_RE.test(w));
  // Real English messages either contain a substantial word (6+ letters, e.g.
  // "tomorrow", "thanks!") or multiple shorter words together ("see you"
  // still has no 4+ letter word — we live without it). Random ASCII runs
  // from the parser rarely clear both bars.
  const hasLongWord = realWords.some((w) => w.length >= 6);
  const hasMultipleWords = realWords.length >= 2;
  if (!hasLongWord && !hasMultipleWords) return false;
  if (!/\s/.test(t)) return false;
  const symbols = (t.match(/[^A-Za-z0-9\s]/g) ?? []).length;
  if (symbols / t.length > 0.3) return false;
  return t.length >= 6;
}

export function filterMessageStrings(strings: readonly ThreadString[]): ThreadString[] {
  return strings.filter((s) => isLikelyMessageText(s.text));
}
