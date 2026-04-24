import type { ThreadString } from './types';

const utf8 = new TextDecoder('utf-8', { fatal: true });

export interface ExtractOptions {
  /** Minimum codepoint count to keep a run. Defaults to 2. */
  minCodepoints?: number;
  /** Optional cap on the number of runs returned. Defaults to unlimited. */
  maxRuns?: number;
}

/**
 * Collect runs of human-readable text (ASCII printable + valid UTF-8
 * multi-byte) from an arbitrary byte buffer.
 *
 * The previous ASCII-only scanner (`extractPrintableStrings`) silently dropped
 * every Japanese character because any 0xE0–0xEF leading byte breaks a run.
 * Real PlusMessage backups are almost entirely Japanese, so the old behavior
 * hid the data the user actually cares about.
 *
 * Rules:
 *   - Single-byte: 0x20–0x7E (printable ASCII) + TAB/CR/LF
 *   - Two-byte:   0xC2–0xDF, then 0x80–0xBF
 *   - Three-byte: 0xE0–0xEF with correct continuation, rejecting over-long
 *                 encodings and the UTF-16 surrogate range (U+D800–U+DFFF)
 *   - Four-byte:  0xF0–0xF4 with correct continuation, rejecting over-long
 *                 and > U+10FFFF
 *   - Runs are measured in codepoints (not bytes) so that a two-character
 *     Japanese word doesn't get lost because it has only 6 bytes.
 */
export function extractTextRuns(
  body: Uint8Array,
  baseOffset: number,
  opts: ExtractOptions = {},
): ThreadString[] {
  const minCodepoints = opts.minCodepoints ?? 2;
  const maxRuns = opts.maxRuns ?? Infinity;
  const out: ThreadString[] = [];

  const n = body.length;
  let i = 0;
  while (i < n) {
    const runStart = i;
    let codepoints = 0;
    while (i < n) {
      const consumed = consumeCodepoint(body, i);
      if (consumed === 0) break;
      i += consumed;
      codepoints += 1;
    }
    if (codepoints >= minCodepoints) {
      const bytes = body.subarray(runStart, i);
      let text: string;
      try {
        text = utf8.decode(bytes);
      } catch {
        // Shouldn't happen — consumeCodepoint already validated each sequence —
        // but fall back to the lossy decoder if the decoder disagrees.
        text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
      }
      out.push({
        offset: baseOffset + runStart,
        length: i - runStart,
        text,
      });
      if (out.length >= maxRuns) return out;
    }
    if (i === runStart) i += 1; // skip unreadable byte
  }
  return out;
}

/**
 * Return the number of bytes consumed if a valid printable codepoint starts at
 * `buf[i]`, otherwise 0. Validates UTF-8 structure, rejects over-long forms
 * and UTF-16 surrogates, and treats control bytes as non-printable (except
 * TAB/CR/LF which real messages use).
 */
function consumeCodepoint(buf: Uint8Array, i: number): number {
  const n = buf.length;
  const b0 = buf[i]!;

  if (b0 < 0x80) {
    if ((b0 >= 0x20 && b0 <= 0x7e) || b0 === 0x09 || b0 === 0x0a || b0 === 0x0d) {
      return 1;
    }
    return 0;
  }

  // 2-byte: 110xxxxx 10xxxxxx, excluding over-long (b0 < 0xC2).
  if (b0 >= 0xc2 && b0 <= 0xdf) {
    if (i + 1 >= n) return 0;
    const b1 = buf[i + 1]!;
    if ((b1 & 0xc0) !== 0x80) return 0;
    return 2;
  }

  // 3-byte: 1110xxxx 10xxxxxx 10xxxxxx.
  if (b0 >= 0xe0 && b0 <= 0xef) {
    if (i + 2 >= n) return 0;
    const b1 = buf[i + 1]!;
    const b2 = buf[i + 2]!;
    if ((b1 & 0xc0) !== 0x80 || (b2 & 0xc0) !== 0x80) return 0;
    // Over-long (U+0000–U+07FF) and surrogate range (U+D800–U+DFFF) rejected.
    if (b0 === 0xe0 && b1 < 0xa0) return 0;
    if (b0 === 0xed && b1 >= 0xa0) return 0;
    return 3;
  }

  // 4-byte: 11110xxx 10xxxxxx 10xxxxxx 10xxxxxx, within U+10000–U+10FFFF.
  if (b0 >= 0xf0 && b0 <= 0xf4) {
    if (i + 3 >= n) return 0;
    const b1 = buf[i + 1]!;
    const b2 = buf[i + 2]!;
    const b3 = buf[i + 3]!;
    if ((b1 & 0xc0) !== 0x80 || (b2 & 0xc0) !== 0x80 || (b3 & 0xc0) !== 0x80) return 0;
    if (b0 === 0xf0 && b1 < 0x90) return 0;
    if (b0 === 0xf4 && b1 >= 0x90) return 0;
    return 4;
  }

  return 0;
}
