import { BinaryReader } from './BinaryReader';
import {
  CONVERSATION_MEDIA,
  CONVERSATION_TEXT,
  GS,
  ITEM_CONVERSATION,
  ITEM_PEER_BUCKET,
  PEER_HEADER_FIXED_SIZE,
  RS,
  TLV_HEADER_SIZE,
} from './constants';
import { readTlv } from './tlv';
import type { InboxMessage, MediaDelivery, SettingsPeer, TlvRecord } from './types';

const utf8 = new TextDecoder('utf-8', { fatal: false });

/** 2015-01-01 … 2027-01-01 — the window every real timestamp falls in. */
const TS_MIN = Date.UTC(2015, 0, 1);
const TS_MAX = Date.UTC(2027, 0, 1);

/** Guards on length-prefixed fields, generous enough for the RCS XML. */
const MAX_STRING = 1 << 20;
const MAX_PEER_BLOCK = 4096;

/**
 * Parse SETTINGS (section type 0x0001) as the structured message store it is.
 *
 * The section is not an opaque blob that has to be scanned for byte patterns
 * — it is a counted container of nested TLVs, and on the real 65MB backup it
 * walks byte-exactly from the count field to the last byte of the section:
 *
 *   [u32 peerCount]
 *   peerCount × TLV(0x0002)                    one bucket per peer, id-sorted
 *     ├ header (field1 bytes)                  counts, then the peer id
 *     └ TLV(0x0003) × n, then TLV(0x0004)      one record per message
 *
 * A bucket's TLV `field1` is not a constant (an earlier note guessed the
 * observed 0x39 was a flag): it is `PEER_HEADER_FIXED_SIZE + peerId.length`.
 * Phones give 57, `operator@kw.ncs.spmode.ne.jp` gives 72 and the 40-byte
 * docomo address gives 84, so the field tracks the id exactly.
 *
 * Replacing the previous anchor scan matters for correctness, not just
 * tidiness: that scan recognised only two of the three header shapes present
 * and so dropped every received +message — 45 of 111 bodies on the real file.
 */
export function parseSettings(rec: TlvRecord): SettingsPeer[] {
  const base = rec.offset + TLV_HEADER_SIZE;
  const r = new BinaryReader(rec.content, 0, rec.content.length);
  const peerCount = r.readU32LE();
  const peers: SettingsPeer[] = [];

  for (let i = 0; i < peerCount && r.remaining >= TLV_HEADER_SIZE; i += 1) {
    // A bucket that runs past the end of the section ends the walk instead of
    // failing the section: a truncated tail should cost the peers it actually
    // damaged, not every conversation in the file.
    let bucket: TlvRecord;
    try {
      bucket = readTlv(r);
    } catch {
      break;
    }
    if (bucket.type !== ITEM_PEER_BUCKET) continue;
    const peer = parsePeerBucket(bucket, base);
    if (peer) peers.push(peer);
  }
  return peers;
}

/**
 * Bucket header layout (`field1` bytes, little-endian):
 *   +0  u32   number of 0x0003 records that follow
 *   +8  u32   how many of them are media deliveries
 *   +32 u32   peer id length, followed by the id itself
 *
 * The bytes at +4, +12..+31 and the 8 that trail the id are still unread.
 * Only the id is load-bearing; the counts are surfaced on
 * {@link SettingsPeer.declared} so a caller can cross-check what it decoded.
 */
function parsePeerBucket(bucket: TlvRecord, sectionBase: number): SettingsPeer | null {
  const headerLen = bucket.field1;
  if (headerLen < PEER_HEADER_FIXED_SIZE || headerLen > bucket.content.length) return null;

  const h = new BinaryReader(bucket.content, 0, headerLen);
  const declaredRecords = h.readU32LE();
  h.skip(4);
  const declaredMedia = h.readU32LE();
  h.skip(20);
  const idLen = h.readU32LE();
  if (idLen < 1 || idLen > h.remaining) return null;
  const peerId = utf8.decode(h.readBytes(idLen));

  const messages: InboxMessage[] = [];
  const media: MediaDelivery[] = [];
  let unknownRecords = 0;
  let displayName: string | undefined;

  const body = new BinaryReader(bucket.content, headerLen, bucket.content.length);
  const recordBase = sectionBase + bucket.offset + TLV_HEADER_SIZE;
  while (body.remaining >= TLV_HEADER_SIZE) {
    let inner: TlvRecord;
    try {
      inner = readTlv(body);
    } catch {
      break;
    }
    // Skips the 0x0004 terminator that closes every bucket, and anything
    // else we have not seen.
    if (inner.type !== ITEM_CONVERSATION) continue;

    const decoded = decodeRecord(inner, peerId, recordBase);
    if (!decoded) {
      unknownRecords += 1;
      continue;
    }
    if (!displayName && decoded.displayName) displayName = decoded.displayName;
    if (decoded.message) messages.push(decoded.message);
    else if (decoded.delivery) media.push(decoded.delivery);
    else unknownRecords += 1;
  }

  const peer: SettingsPeer = {
    peerId,
    messages,
    media,
    unknownRecords,
    declared: { records: declaredRecords, media: declaredMedia },
    offset: sectionBase + bucket.offset,
    length: bucket.raw.length,
  };
  if (displayName) peer.displayName = displayName;
  return peer;
}

interface DecodedRecord {
  displayName?: string;
  message?: InboxMessage;
  delivery?: MediaDelivery;
}

/**
 * Decode one 0x0003 record. Both variants share a prologue:
 *
 *   [u16 variant][u16 0x0003][u32 seq]
 *   [u32 len][contact block]        the peer, as a GS-delimited blob
 *   [u32 len][contact block]        repeated on some records, len 0 on others
 *   [u32 × 5][i64 timestamp]
 *
 * and then diverge — see {@link decodeText} and {@link decodeMedia}. The five
 * u32s mean different things in each variant, so they are read there.
 */
function decodeRecord(rec: TlvRecord, peerId: string, base: number): DecodedRecord | null {
  const r = new BinaryReader(rec.content, 0, rec.content.length);
  try {
    const variant = r.readU16LE();
    r.skip(2 + 4); // inner type tag, record sequence
    const contactBlock = readBlock(r);
    readBlock(r); // second copy, empty on most records — see Q12
    if (!contactBlock) return null;

    const displayName = readDisplayName(contactBlock);
    const fields = [r.readU32LE(), r.readU32LE(), r.readU32LE(), r.readU32LE(), r.readU32LE()];
    const timestamp = readTimestamp(r);
    if (!timestamp) return null;

    const offset = base + rec.offset;
    const length = rec.raw.length;
    if (variant === CONVERSATION_TEXT) {
      const message = decodeText(r, fields, timestamp, peerId, offset, length);
      return message ? withName({ message }, displayName) : null;
    }
    if (variant === CONVERSATION_MEDIA) {
      const delivery = decodeMedia(r, timestamp, peerId, offset, length);
      return delivery ? withName({ delivery }, displayName) : null;
    }
    return withName({}, displayName);
  } catch {
    return null;
  }
}

function withName(rec: DecodedRecord, displayName: string | undefined): DecodedRecord {
  if (displayName) rec.displayName = displayName;
  return rec;
}

/**
 * Text message tail: `[i64 sent][str body][str mime][str id][str sip]`.
 *
 * Of the five u32s before the timestamp, index 0 is the direction (7 received
 * / 6 sent) and index 3 the transport (5 SMS / 4 +message). The old anchor
 * scan matched the whole run literally and only ever listed received-SMS and
 * sent-+message, which is why received +messages went missing.
 */
function decodeText(
  r: BinaryReader,
  fields: readonly number[],
  timestamp: { ms: number; iso: string },
  peerId: string,
  offset: number,
  length: number,
): InboxMessage | null {
  const text = readString(r);
  const mimeType = readString(r);
  const id = readString(r);
  const sipMetadata = readString(r) ?? '';
  if (text === null || mimeType === null || id === null) return null;

  return {
    id,
    peerId,
    text: mimeType.startsWith('text/') ? text : '',
    mimeType,
    timestamp,
    direction: fields[0] === 6 ? 'outgoing' : fields[0] === 7 ? 'incoming' : 'unknown',
    transport: fields[3] === 5 ? 'sms' : fields[3] === 4 ? 'rcs' : 'unknown',
    sipMetadata,
    offset,
    length,
  };
}

/**
 * Media tail: `[u32 × 2][i64 expiry][u32 × 2][str source][str category]
 * [u32][str mime][str id][str rcsXml]`.
 *
 * The `mime` field describes the thumbnail, so the full-size type is taken
 * from the RCS descriptor instead and `mime` is skipped.
 */
function decodeMedia(
  r: BinaryReader,
  timestamp: { ms: number; iso: string },
  peerId: string,
  offset: number,
  length: number,
): MediaDelivery | null {
  r.skip(8);
  const expiresAt = readTimestamp(r);
  r.skip(8);
  const sourcePath = readString(r);
  const category = readString(r);
  r.skip(4);
  readString(r); // thumbnail content type
  readString(r); // per-delivery id, distinct from the file name
  const xml = readString(r);
  if (sourcePath === null || category === null || xml === null) return null;

  const descriptor = readFileDescriptor(xml);
  if (!descriptor.name) return null;

  const delivery: MediaDelivery = {
    name: descriptor.name,
    peerId,
    timestamp,
    direction: mediaDirection(sourcePath),
    contentType: descriptor.contentType || category.split('|')[0] || '',
    category,
    isSticker: category.includes('sticker'),
    sourcePath,
    offset,
    length,
  };
  if (descriptor.fileSize !== undefined) delivery.fileSize = descriptor.fileSize;
  if (expiresAt) delivery.expiresAt = expiresAt;
  return delivery;
}

/**
 * Which side sent the file, inferred from where the app kept its source.
 *
 * Observed: 14 of the 44 deliveries point at device storage
 * (`0,app://photos-kit/…`, `0,/var/mobile/…`) and 30 at the carrier asset
 * server (`0,https://a-wss…`). Interpretation: only the sender ever holds the
 * local file — a received file is known solely by its URL — so a device path
 * means we sent it. The split matches the independent THREAD `headerFlag`
 * (0 = device-local, 1 = downloaded), which is what makes this more than a
 * guess, but it remains an inference rather than a decoded direction field.
 * See Q12 in docs/open-questions.md.
 */
function mediaDirection(sourcePath: string): 'incoming' | 'outgoing' {
  return /^0,https?:\/\//i.test(sourcePath) ? 'incoming' : 'outgoing';
}

interface FileDescriptor {
  name: string;
  contentType: string;
  fileSize?: number;
}

const FILE_INFO_RE = /<file-info\s+type="file">([\s\S]*?)<\/file-info>/;
const FILE_NAME_RE = /<file-name>([^<]*)<\/file-name>/;
const CONTENT_TYPE_RE = /<content-type>([^<]*)<\/content-type>/;
const FILE_SIZE_RE = /<file-size>(\d+)<\/file-size>/;

/**
 * Pull the full-size entry out of the RCS `<file>` document.
 *
 * The document holds a `thumbnail` entry and a `file` entry; only the latter
 * carries `<file-name>`, which is the key that joins this delivery to the
 * THREAD record storing the bytes. Matched with regexes rather than a parser
 * because DOMParser does not exist in a Worker.
 */
function readFileDescriptor(xml: string): FileDescriptor {
  const scope = FILE_INFO_RE.exec(xml)?.[1] ?? xml;
  const size = FILE_SIZE_RE.exec(scope)?.[1];
  const descriptor: FileDescriptor = {
    name: FILE_NAME_RE.exec(scope)?.[1] ?? '',
    contentType: CONTENT_TYPE_RE.exec(scope)?.[1] ?? '',
  };
  if (size !== undefined) descriptor.fileSize = Number(size);
  return descriptor;
}

function readBlock(r: BinaryReader): Uint8Array | null {
  const len = r.readU32LE();
  if (len === 0) return null;
  if (len > MAX_PEER_BLOCK) throw new Error(`peer block too long: ${len}`);
  return r.readBytes(len);
}

function readString(r: BinaryReader): string | null {
  if (r.remaining < 4) return null;
  const len = r.readU32LE();
  if (len > MAX_STRING || len > r.remaining) return null;
  return utf8.decode(r.readBytes(len));
}

function readTimestamp(r: BinaryReader): { ms: number; iso: string } | null {
  const ms = Number(r.readI64LE());
  if (!Number.isFinite(ms) || ms < TS_MIN || ms > TS_MAX) return null;
  return { ms, iso: new Date(ms).toISOString() };
}

/**
 * Display name from a record's contact blob.
 *
 * The blob is `0 GS "" GS <name> GS tel GS <phone> GS … RS <peer id> RS`, so
 * the name is the field immediately before the `tel` channel tag. It is often
 * empty — CONTACTS (0x000d) leaves the name blank on all 85 entries, making
 * this blob the only place a name survives at all.
 */
function readDisplayName(block: Uint8Array): string | undefined {
  const fields: string[] = [];
  let start = 0;
  for (let i = 0; i <= block.length; i += 1) {
    if (i === block.length || block[i] === GS || block[i] === RS) {
      fields.push(utf8.decode(block.subarray(start, i)));
      start = i + 1;
    }
  }
  const tel = fields.indexOf('tel');
  if (tel < 1) return undefined;
  const name = fields[tel - 1]?.trim();
  return name ? name : undefined;
}
