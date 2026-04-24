import { BinaryReader } from './BinaryReader';
import { TLV_HEADER_SIZE } from './constants';
import type { InboxBucket, InboxMessage, TlvRecord } from './types';

const utf8 = new TextDecoder('utf-8', { fatal: false });

/**
 * 20-byte pattern that precedes every inbox message record. Five little-endian
 * u32s: 7, 1, 0, 5, 0. We anchor on this rather than trying to understand the
 * variable peer-bucket framing — the anchor is unambiguous and gives exact
 * message offsets.
 */
const MESSAGE_ANCHOR = new Uint8Array([
  0x07, 0x00, 0x00, 0x00,
  0x01, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00,
  0x05, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00,
]);

/**
 * Parse the SETTINGS-typed section as an SMS inbox store.
 *
 * Strategy: scan the entire section content in two passes.
 *   1. Collect every occurrence of a length-prefixed ASCII `+`-phone number.
 *   2. Collect every MESSAGE_ANCHOR occurrence, parse the message record
 *      starting at each, and associate it with the nearest preceding phone.
 *
 * This avoids fragile assumptions about the outer bucket framing (which has
 * a few unidentified length fields) — we only care about message offsets and
 * peer identity. Messages sharing a phone are grouped into one InboxBucket.
 */
export function parseInbox(rec: TlvRecord): InboxBucket[] {
  const content = rec.content;
  if (content.length < MESSAGE_ANCHOR.length) return [];
  const baseOffset = rec.offset + TLV_HEADER_SIZE;

  const phones = findAllPeerPhones(content);
  const anchors = findAllAnchors(content);
  if (anchors.length === 0) return [];

  type Accum = {
    messages: InboxMessage[];
    firstOffset: number;
    lastOffset: number;
  };
  const byPhone = new Map<string, Accum>();

  for (const anchor of anchors) {
    const peerPhone = nearestPrecedingPhone(phones, anchor) ?? '';
    const parsed = readMessage(content, anchor, peerPhone, baseOffset);
    if (!parsed) continue;

    const key = peerPhone;
    const endOffset = parsed.message.offset + parsed.message.length;
    const existing = byPhone.get(key);
    if (existing) {
      existing.messages.push(parsed.message);
      if (parsed.message.offset < existing.firstOffset) {
        existing.firstOffset = parsed.message.offset;
      }
      if (endOffset > existing.lastOffset) existing.lastOffset = endOffset;
    } else {
      byPhone.set(key, {
        messages: [parsed.message],
        firstOffset: parsed.message.offset,
        lastOffset: endOffset,
      });
    }
  }

  const buckets: InboxBucket[] = [];
  for (const [peerPhone, accum] of byPhone) {
    buckets.push({
      peerPhone,
      messages: accum.messages,
      offset: accum.firstOffset,
      length: accum.lastOffset - accum.firstOffset,
    });
  }
  return buckets;
}

interface MessageParseResult {
  message: InboxMessage;
  nextOffset: number;
}

function readMessage(
  buf: Uint8Array,
  anchorOffset: number,
  peerPhone: string,
  sectionBaseOffset: number,
): MessageParseResult | null {
  const start = anchorOffset;
  const r = new BinaryReader(buf, start, buf.length);
  try {
    r.skip(MESSAGE_ANCHOR.length);
    const tsMsBig = r.readI64LE();
    const tsMs = Number(tsMsBig);
    const textLen = r.readU32LE();
    if (textLen > buf.length) return null;
    const textBytes = r.readBytes(textLen);
    const mimeLen = r.readU32LE();
    if (mimeLen > 256) return null;
    const mimeBytes = r.readBytes(mimeLen);
    const uuidLen = r.readU32LE();
    if (uuidLen > 128) return null;
    const uuidBytes = r.readBytes(uuidLen);
    const sipLen = r.readU32LE();
    if (sipLen > 4096) return null;
    const sipBytes = r.readBytes(sipLen);

    const mimeType = utf8.decode(mimeBytes);
    const text = mimeType.startsWith('text/')
      ? utf8.decode(textBytes)
      : '';
    const iso = Number.isFinite(tsMs) && tsMs > 0 && tsMs < 4102444800000
      ? new Date(tsMs).toISOString()
      : '';

    const end = r.offset;
    const message: InboxMessage = {
      id: utf8.decode(uuidBytes),
      peerPhone,
      text,
      mimeType,
      timestamp: { ms: tsMs, iso },
      direction: 'unknown',
      sipMetadata: utf8.decode(sipBytes),
      offset: sectionBaseOffset + start,
      length: end - start,
    };
    return { message, nextOffset: end };
  } catch {
    return null;
  }
}

function findAllAnchors(content: Uint8Array): number[] {
  const hits: number[] = [];
  let from = 0;
  while (from <= content.length - MESSAGE_ANCHOR.length) {
    const at = indexOfBytes(content, MESSAGE_ANCHOR, from);
    if (at < 0) break;
    hits.push(at);
    from = at + MESSAGE_ANCHOR.length;
  }
  return hits;
}

interface PhoneMarker {
  offset: number;
  phone: string;
}

/**
 * Find every length-prefixed `+`-phone in the content. Phones are stored as
 * u32-length + ASCII digits; typical Japanese mobile is 13 bytes (`+81…`).
 * Several copies appear per bucket (once as the peer identity, several inside
 * the contact blob). We keep them all and later resolve by nearest-preceding.
 */
function findAllPeerPhones(content: Uint8Array): PhoneMarker[] {
  const out: PhoneMarker[] = [];
  const n = content.length;
  let i = 0;
  while (i + 4 < n) {
    const len = readU32LE(content, i);
    if (len < 8 || len > 20) {
      i += 1;
      continue;
    }
    const startAt = i + 4;
    if (startAt + len > n) {
      i += 1;
      continue;
    }
    if (content[startAt] !== 0x2b /* '+' */) {
      i += 1;
      continue;
    }
    let allDigits = true;
    for (let k = 1; k < len; k += 1) {
      const b = content[startAt + k]!;
      if (b < 0x30 || b > 0x39) { allDigits = false; break; }
    }
    if (!allDigits) {
      i += 1;
      continue;
    }
    out.push({
      offset: i,
      phone: utf8.decode(content.subarray(startAt, startAt + len)),
    });
    i = startAt + len;
  }
  return out;
}

function nearestPrecedingPhone(phones: readonly PhoneMarker[], target: number): string | undefined {
  let best: string | undefined;
  for (const p of phones) {
    if (p.offset > target) break;
    best = p.phone;
  }
  return best;
}

function readU32LE(buf: Uint8Array, offset: number): number {
  return (
    (buf[offset]! |
      (buf[offset + 1]! << 8) |
      (buf[offset + 2]! << 16) |
      (buf[offset + 3]! << 24)) >>> 0
  );
}

function indexOfBytes(haystack: Uint8Array, needle: Uint8Array, from: number): number {
  const n = haystack.length;
  const m = needle.length;
  if (m === 0 || m > n - from) return -1;
  const first = needle[0]!;
  outer: for (let i = from; i <= n - m; i += 1) {
    if (haystack[i] !== first) continue;
    for (let j = 1; j < m; j += 1) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}
