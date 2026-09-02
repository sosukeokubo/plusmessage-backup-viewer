import { Inflate } from 'pako';
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
          encoding: 'raw',
        });
        i = end;
        continue;
      }
    }
    i += 1;
  }
  return out;
}

/**
 * Image formats we recognise inside zlib-wrapped streams, keyed by their
 * leading magic bytes. `type` doubles as both `AttachmentRef.kind` and
 * `contentType` — they are the same string for every format we support.
 *
 * GIF87a and GIF89a are listed separately rather than matched on the shared
 * `GIF8` prefix so an arbitrary `GIF8xx` payload can't slip through.
 */
interface ImageSignature {
  type: 'image/png' | 'image/gif';
  magic: readonly number[];
}

const ZLIB_IMAGE_SIGNATURES: readonly ImageSignature[] = [
  { type: 'image/png', magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { type: 'image/gif', magic: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61] }, // "GIF87a"
  { type: 'image/gif', magic: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61] }, // "GIF89a"
];

/** Return the signature whose magic bytes `buf` starts with, or null. */
function matchImageSignature(buf: Uint8Array): ImageSignature | null {
  for (const sig of ZLIB_IMAGE_SIGNATURES) {
    if (buf.length < sig.magic.length) continue;
    let matched = true;
    for (let i = 0; i < sig.magic.length; i += 1) {
      if (buf[i] !== sig.magic[i]) {
        matched = false;
        break;
      }
    }
    if (matched) return sig;
  }
  return null;
}

/**
 * Try to inflate `buf` starting at byte 0 as a zlib-wrapped DEFLATE stream.
 * On success returns both the inflated bytes and the number of input bytes
 * actually consumed. Returns null if the stream is malformed or pako throws.
 *
 * Implementation detail: we skip the 2-byte zlib header and push the raw
 * DEFLATE stream into pako with `raw: true`. This avoids pako's auto-concat
 * behavior, which, in zlib-wrap mode, calls `inflateReset` on any trailing
 * non-zero byte after Z_STREAM_END and attempts to decode it as another zlib
 * stream — behavior that wrecks `total_in` when we're scanning inside a
 * larger file where trailing bytes are expected. Caller already validated the
 * 2-byte header via the CMF/FLG checksum rule. The trailing adler32 (4B) is
 * not consumed by raw inflate, so we add it back to report the full length
 * of the zlib stream in the source buffer.
 */
function tryInflate(buf: Uint8Array): { result: Uint8Array; consumed: number } | null {
  // zlib stream minimum is 2 (header) + 2 (deflate empty block) + 4 (adler32).
  if (buf.length < 8) return null;
  try {
    const inf = new Inflate({ raw: true });
    inf.push(buf.subarray(2));
    // `ended` and `strm` are runtime properties on pako's Inflate that the
    // shipped .d.ts doesn't expose. Cast through once to reach both.
    const internals = inf as unknown as { ended: boolean; strm: { total_in: number } };
    if (inf.err || !internals.ended) return null;
    const result = inf.result;
    if (!(result instanceof Uint8Array)) return null;
    const rawConsumed = internals.strm.total_in;
    if (!Number.isFinite(rawConsumed) || rawConsumed <= 0) return null;
    const consumed = 2 + rawConsumed + 4; // zlib header + deflate + adler32
    if (consumed > buf.length) return null;
    return { result, consumed };
  } catch {
    return null;
  }
}

/**
 * Scan `body` for zlib-wrapped image payloads. A candidate starts at any byte
 * where CMF=0x78 and (CMF*256+FLG) mod 31 === 0 (the zlib header checksum
 * rule). Each candidate is test-inflated; only those whose inflated output
 * begins with a known image signature (see ZLIB_IMAGE_SIGNATURES) are
 * recorded.
 *
 * The zlib header carries no hint about its payload, so the format can only
 * be told apart after inflating — which is why the signature test lives here
 * rather than in the prefilter.
 *
 * The checksum prefilter drops the vast majority of random byte matches
 * before the expensive inflate call, which is important on 65MB backups.
 */
export function scanZlibImages(body: Uint8Array, baseOffset: number): AttachmentRef[] {
  const out: AttachmentRef[] = [];
  let i = 0;
  while (i < body.length - 1) {
    if (body[i] === 0x78) {
      const cmf = body[i]!;
      const flg = body[i + 1]!;
      if (((cmf << 8) | flg) % 31 === 0) {
        const res = tryInflate(body.subarray(i));
        const sig = res && matchImageSignature(res.result);
        if (res && sig) {
          out.push({
            kind: sig.type,
            contentType: sig.type,
            sourceOffset: baseOffset + i,
            length: res.consumed,
            encoding: 'zlib',
            decompressedLength: res.result.length,
          });
          i += res.consumed;
          continue;
        }
      }
    }
    i += 1;
  }
  return out;
}

/** Scan both raw JPEG and zlib-wrapped PNG/GIF attachments, ordered by offset. */
export function scanAttachments(body: Uint8Array, baseOffset: number): AttachmentRef[] {
  const all = [...scanJpegs(body, baseOffset), ...scanZlibImages(body, baseOffset)];
  all.sort((a, b) => a.sourceOffset - b.sourceOffset);
  return all;
}
