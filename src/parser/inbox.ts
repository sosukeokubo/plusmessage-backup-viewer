import { BinaryReader } from './BinaryReader';
import { GS, RS, TLV_HEADER_SIZE } from './constants';
import type { InboxBucket, InboxMessage, TlvRecord } from './types';

const utf8 = new TextDecoder('utf-8', { fatal: false });

/**
 * 20-byte patterns that precede every message record. Five little-endian
 * u32s. The first and fourth differ between incoming (received SMS or
 * received +message) and outgoing (sent +message) records — confirmed by
 * grep-bytes verification on the real 65MB backup against four known sent
 * phrases (docs/findings-2026-04-26.md):
 *
 *   incoming: 7, 1, 0, 5, 0   →  mime=`text/plain;charset=utf-8`
 *   outgoing: 6, 1, 0, 4, 0   →  mime=`text/plain`
 *
 * Anchoring on these patterns avoids the still-unparsed peer-bucket framing.
 */
export const ANCHOR_INCOMING = new Uint8Array([
  0x07, 0x00, 0x00, 0x00,
  0x01, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00,
  0x05, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00,
]);

export const ANCHOR_OUTGOING = new Uint8Array([
  0x06, 0x00, 0x00, 0x00,
  0x01, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00,
  0x04, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00,
]);

/** Backwards-compatible alias — older call sites import MESSAGE_ANCHOR. */
export const MESSAGE_ANCHOR = ANCHOR_INCOMING;

export interface AnchorHit {
  offset: number;
  direction: 'incoming' | 'outgoing';
}

/**
 * Parse the SETTINGS-typed section as an SMS inbox store.
 *
 * Strategy: scan the entire section content in two passes.
 *   1. Collect every peer identity marker (see {@link findAllPeerIds}).
 *   2. Collect every MESSAGE_ANCHOR occurrence, parse the message record
 *      starting at each, and associate it with the nearest preceding peer.
 *
 * This avoids fragile assumptions about the outer bucket framing (which has
 * a few unidentified length fields) — we only care about message offsets and
 * peer identity. Messages sharing a peer are grouped into one InboxBucket.
 */
export function parseInbox(rec: TlvRecord): InboxBucket[] {
  const content = rec.content;
  if (content.length < MESSAGE_ANCHOR.length) return [];
  const baseOffset = rec.offset + TLV_HEADER_SIZE;

  const peers = findAllPeerIds(content);
  const anchors = findAllAnchors(content);
  if (anchors.length === 0) return [];

  type Accum = {
    messages: InboxMessage[];
    firstOffset: number;
    lastOffset: number;
  };
  const byPeer = new Map<string, Accum>();

  for (const anchor of anchors) {
    const peerId = nearestPrecedingPeer(peers, anchor.offset) ?? '';
    const parsed = readMessage(content, anchor, peerId, baseOffset);
    if (!parsed) continue;

    const key = peerId;
    const endOffset = parsed.message.offset + parsed.message.length;
    const existing = byPeer.get(key);
    if (existing) {
      existing.messages.push(parsed.message);
      if (parsed.message.offset < existing.firstOffset) {
        existing.firstOffset = parsed.message.offset;
      }
      if (endOffset > existing.lastOffset) existing.lastOffset = endOffset;
    } else {
      byPeer.set(key, {
        messages: [parsed.message],
        firstOffset: parsed.message.offset,
        lastOffset: endOffset,
      });
    }
  }

  const buckets: InboxBucket[] = [];
  for (const [peerId, accum] of byPeer) {
    buckets.push({
      peerId,
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
  anchor: AnchorHit,
  peerId: string,
  sectionBaseOffset: number,
): MessageParseResult | null {
  const start = anchor.offset;
  const r = new BinaryReader(buf, start, buf.length);
  try {
    r.skip(ANCHOR_INCOMING.length);
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
      peerId,
      text,
      mimeType,
      timestamp: { ms: tsMs, iso },
      direction: anchor.direction,
      sipMetadata: utf8.decode(sipBytes),
      offset: sectionBaseOffset + start,
      length: end - start,
    };
    return { message, nextOffset: end };
  } catch {
    return null;
  }
}

export function findAllAnchors(content: Uint8Array): AnchorHit[] {
  const incoming = collectAnchorOffsets(content, ANCHOR_INCOMING).map(
    (offset): AnchorHit => ({ offset, direction: 'incoming' }),
  );
  const outgoing = collectAnchorOffsets(content, ANCHOR_OUTGOING).map(
    (offset): AnchorHit => ({ offset, direction: 'outgoing' }),
  );
  return [...incoming, ...outgoing].sort((a, b) => a.offset - b.offset);
}

function collectAnchorOffsets(content: Uint8Array, anchor: Uint8Array): number[] {
  const hits: number[] = [];
  let from = 0;
  while (from <= content.length - anchor.length) {
    const at = indexOfBytes(content, anchor, from);
    if (at < 0) break;
    hits.push(at);
    from = at + anchor.length;
  }
  return hits;
}

export interface PeerMarker {
  offset: number;
  peerId: string;
}

const PEER_ID_MIN = 3;
const PEER_ID_MAX = 80;

/** `+` followed by 8–15 digits, or a `local@domain` service address. */
function isPeerId(token: string): boolean {
  if (/^\+\d{8,15}$/.test(token)) return true;
  return /^[^\s@]{1,64}@[A-Za-z0-9.-]{3,64}$/.test(token);
}

/**
 * Find every peer identity marker in the SETTINGS content.
 *
 * A peer identity closes its contact blob as an RS-delimited token
 * (`0x1e <id> 0x1e`) — verified on the real 65MB backup, where this yields
 * exactly 20 distinct ids: 18 `+81…` phones plus the two service addresses
 * `operator@kw.ncs.spmode.ne.jp` and
 * `docomoPlusMessagePoint@maap.plus-msg.com`.
 *
 * The earlier phone-only scan (u32-length + `+digits`) missed both service
 * addresses, so their 12 messages were charged to the preceding phone bucket.
 * Everything downstream resolves a peer by nearest-preceding marker, so a
 * missing marker silently misattributes an entire bucket.
 */
export function findAllPeerIds(content: Uint8Array): PeerMarker[] {
  const out: PeerMarker[] = [];
  for (let i = 0; i < content.length; i += 1) {
    if (content[i] !== RS) continue;
    let j = i + 1;
    while (j < content.length && j - i - 1 <= PEER_ID_MAX) {
      const b = content[j]!;
      if (b === RS) break;
      if (b < 0x20 || b > 0x7e) break;
      j += 1;
    }
    const len = j - i - 1;
    if (len < PEER_ID_MIN || len > PEER_ID_MAX) continue;
    if (content[j] !== RS) continue;
    const token = utf8.decode(content.subarray(i + 1, j));
    if (!isPeerId(token)) continue;
    out.push({ offset: i, peerId: token });
  }
  return out;
}

export function nearestPrecedingPeer(peers: readonly PeerMarker[], target: number): string | undefined {
  let best: string | undefined;
  for (const p of peers) {
    if (p.offset > target) break;
    best = p.peerId;
  }
  return best;
}

/** `GS t e l GS` — the channel tag that precedes the peer's number. */
const TEL_TAG = new Uint8Array([GS, 0x74, 0x65, 0x6c, GS]);

/**
 * Recover display names from the contact blobs embedded in message records.
 *
 * The blob is GS-delimited as `0 GS "" GS <name> GS tel GS <phone> GS …`, so
 * the field right before the `tel` tag is the display name. The same blob is
 * repeated on every message, and the name is not always filled in, so we take
 * the most frequent non-empty spelling per peer.
 *
 * The CONTACTS section (0x000d) carries the same field shape but leaves the
 * name empty for all 85 entries on the real backup — SETTINGS is the only
 * place a name survives.
 */
export function extractPeerNames(content: Uint8Array): Record<string, string> {
  const tally = new Map<string, Map<string, number>>();
  let from = 0;
  for (;;) {
    const at = indexOfBytes(content, TEL_TAG, from);
    if (at < 0) break;
    from = at + TEL_TAG.length;

    let end = from;
    while (end < content.length && content[end] !== GS) end += 1;
    const phone = utf8.decode(content.subarray(from, end));
    if (!/^\+\d{8,15}$/.test(phone)) continue;

    let start = at - 1;
    while (start >= 0 && content[start] !== GS) start -= 1;
    if (start < 0) continue;
    const name = utf8.decode(content.subarray(start + 1, at)).trim();
    if (!name) continue;

    const counts = tally.get(phone) ?? new Map<string, number>();
    counts.set(name, (counts.get(name) ?? 0) + 1);
    tally.set(phone, counts);
  }

  const out: Record<string, string> = {};
  for (const [phone, counts] of tally) {
    let best = '';
    let bestCount = 0;
    for (const [name, count] of counts) {
      if (count > bestCount) { best = name; bestCount = count; }
    }
    if (best) out[phone] = best;
  }
  return out;
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
