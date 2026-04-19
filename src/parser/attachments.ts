import type { AttachmentRef } from './types';

/**
 * Walk a JPEG stream that begins at `start` (pointing at the SOI `0xFF 0xD8`)
 * and return the exclusive end offset of the EOI marker `0xFF 0xD9`. Returns
 * null if the stream is malformed or runs out of data before EOI.
 *
 * Full JFIF/JPEG segment semantics are honored so embedded EXIF thumbnails
 * (which contain their own FFD8/FFD9 pair inside an APP1 payload) are skipped
 * over rather than mistaken for the outer image boundary.
 */
export function findJpegEnd(buf: Uint8Array, start: number): number | null {
  if (buf[start] !== 0xff || buf[start + 1] !== 0xd8) return null;
  let p = start + 2;
  while (p < buf.length - 1) {
    if (buf[p] !== 0xff) return null;
    // Marker prefix may have one or more 0xFF fill bytes.
    while (p < buf.length && buf[p] === 0xff) p += 1;
    if (p >= buf.length) return null;
    const marker = buf[p]!;
    p += 1;

    if (marker === 0xd9) return p; // EOI — exclusive end

    // Standalone markers (no payload): TEM (0x01), RST0–7 (0xD0–D7).
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;

    if (marker === 0xda) {
      // SOS: length-prefixed header, then entropy-coded scan data that
      // continues until the next non-escape, non-restart marker.
      if (p + 2 > buf.length) return null;
      const len = (buf[p]! << 8) | buf[p + 1]!;
      p += len;
      while (p < buf.length - 1) {
        if (buf[p] === 0xff) {
          const next = buf[p + 1];
          if (next === 0x00 || next === 0xff) {
            // 0xFF00 is a byte-stuffed 0xFF data byte; 0xFFFF is a fill byte.
            p += 1;
            continue;
          }
          if (next !== undefined && next >= 0xd0 && next <= 0xd7) {
            p += 2; // RSTn — keep scanning entropy data.
            continue;
          }
          break; // real marker — loop back to the outer dispatch.
        }
        p += 1;
      }
      continue;
    }

    // All other markers carry a u16BE length that includes the length field.
    if (p + 2 > buf.length) return null;
    const len = (buf[p]! << 8) | buf[p + 1]!;
    if (len < 2) return null;
    p += len;
  }
  return null;
}

/**
 * Scan `body` for JPEG streams by locating `FF D8 FF` prefixes and walking
 * each one to its EOI. Offsets in the returned refs are absolute to the
 * original file (pass `baseOffset` = body's absolute position).
 *
 * Detection is heuristic — we don't yet understand the thread-body metadata
 * layout that would tell us exactly where each attachment record starts.
 * Relying on JPEG's own framing is correct for valid JPEGs in any context.
 */
export function scanJpegs(body: Uint8Array, baseOffset: number): AttachmentRef[] {
  const out: AttachmentRef[] = [];
  let i = 0;
  while (i < body.length - 2) {
    if (body[i] === 0xff && body[i + 1] === 0xd8 && body[i + 2] === 0xff) {
      const end = findJpegEnd(body, i);
      if (end !== null) {
        out.push({
          kind: 'image/jpeg',
          contentType: 'image/jpeg',
          sourceOffset: baseOffset + i,
          length: end - i,
        });
        i = end;
        continue;
      }
    }
    i += 1;
  }
  return out;
}
