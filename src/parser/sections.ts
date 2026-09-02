import { BinaryReader } from './BinaryReader';
import {
  CONTACT_TAIL_SIZE,
  GS,
  ITEM_CONTACT,
  ITEM_KEY_VALUE,
  MAGIC_BYTES,
  PARSER_VERSION,
  PREAMBLE_SIZE,
  RS,
  SECTION_CONTACTS,
  SECTION_END,
  SECTION_MESSAGES,
  SECTION_META,
  SECTION_SETTINGS,
  SECTION_THREAD,
  THREAD_HEADER_SIZE,
  TLV_HEADER_SIZE,
} from './constants';
import { iterateTlvs, readTlv } from './tlv';
import { scanAttachments } from './attachments';
import { extractPeerNames, findAllPeerIds, parseInbox } from './inbox';
import { assignThreadPeers, readMediaHeader } from './media';
import { extractTextRuns } from './textRuns';
import type {
  Backup,
  BackupSummary,
  Contact,
  ContactSummary,
  InboxBucket,
  KeyValueItem,
  KeyValueItemSummary,
  Meta,
  MetaSummary,
  ParseProgress,
  RawChunk,
  RawChunkSummary,
  Thread,
  ThreadSummary,
  TlvRecord,
} from './types';

function toRawChunk(rec: TlvRecord): RawChunk {
  return { type: rec.type, offset: rec.offset, bytes: rec.raw };
}

function isMagicAt(buffer: Uint8Array, offset: number): boolean {
  if (offset + MAGIC_BYTES.length > buffer.length) return false;
  for (let i = 0; i < MAGIC_BYTES.length; i += 1) {
    if (buffer[offset + i] !== MAGIC_BYTES[i]) return false;
  }
  return true;
}

const utf8 = new TextDecoder('utf-8', { fatal: false });

/**
 * Read a `[u32LE count][N × TLV record]` container. Used by both META
 * (inner type=0x000c) and CONTACTS (inner type=0x000e). Verified against
 * the real 65MB backup: every top-level META/CONTACTS container obeys this.
 */
function readCountedContainer(
  content: Uint8Array,
  expectedInnerType: number,
): TlvRecord[] {
  if (content.length < 4) {
    throw new Error(`counted container too short: ${content.length}B`);
  }
  const reader = new BinaryReader(content, 0, content.length);
  const count = reader.readU32LE();
  const records: TlvRecord[] = [];
  for (let i = 0; i < count; i += 1) {
    const rec = readTlv(reader);
    if (rec.type !== expectedInnerType) {
      throw new Error(
        `unexpected inner type 0x${rec.type.toString(16)} at item ${i} (expected 0x${expectedInnerType.toString(16)})`,
      );
    }
    records.push(rec);
  }
  return records;
}

/**
 * Inner KV record (type=0x000c) content layout:
 *   keyLen:   u32 LE
 *   key:      UTF-8 bytes
 *   valueLen: u32 LE
 *   value:    bytes (UTF-8 for META)
 */
function decodeKeyValue(rec: TlvRecord, baseOffset: number): KeyValueItem {
  const r = new BinaryReader(rec.content, 0, rec.content.length);
  const keyLen = r.readU32LE();
  const keyBytes = r.readBytes(keyLen);
  const valueLen = r.readU32LE();
  const valueBytes = r.readBytes(valueLen);
  return {
    key: utf8.decode(keyBytes),
    value: valueBytes,
    valueUtf8: utf8.decode(valueBytes),
    offset: baseOffset + rec.offset,
    raw: rec.raw,
  };
}

/**
 * Inner CONTACT record (type=0x000e) content layout:
 *   keyLen:   u32 LE        — phone number
 *   key:      UTF-8
 *   valueLen: u32 LE        — value blob
 *   value:    GS/RS-delimited ASCII (0x1d / 0x1e)
 *   tail:     20 bytes       — flags/padding (byte 8 observed to be 0x01)
 */
function decodeContact(rec: TlvRecord, baseOffset: number): Contact {
  const r = new BinaryReader(rec.content, 0, rec.content.length);
  const keyLen = r.readU32LE();
  const keyBytes = r.readBytes(keyLen);
  const valueLen = r.readU32LE();
  const valueBytes = r.readBytes(valueLen);
  if (r.remaining !== CONTACT_TAIL_SIZE) {
    throw new Error(
      `contact tail size mismatch: expected ${CONTACT_TAIL_SIZE}, got ${r.remaining}`,
    );
  }
  const tail = r.readBytes(CONTACT_TAIL_SIZE);

  const { fields, otherRecords } = splitContactValue(valueBytes);
  const phone = utf8.decode(keyBytes);
  const name = deriveContactName(fields, phone);

  const contact: Contact = {
    raw: {
      type: rec.type,
      offset: baseOffset + rec.offset,
      bytes: rec.raw,
    },
    phone,
    fields,
    otherRecords,
    valueRaw: valueBytes,
    tail,
  };
  if (name !== undefined) contact.name = name;
  return contact;
}

function splitContactValue(value: Uint8Array): { fields: string[]; otherRecords: string[] } {
  const records: Uint8Array[] = [];
  let start = 0;
  for (let i = 0; i < value.length; i += 1) {
    if (value[i] === RS) {
      records.push(value.subarray(start, i));
      start = i + 1;
    }
  }
  records.push(value.subarray(start));

  const decodeFields = (buf: Uint8Array): string[] => {
    const parts: string[] = [];
    let s = 0;
    for (let i = 0; i < buf.length; i += 1) {
      if (buf[i] === GS) {
        parts.push(utf8.decode(buf.subarray(s, i)));
        s = i + 1;
      }
    }
    parts.push(utf8.decode(buf.subarray(s)));
    return parts;
  };

  const firstRecord = records[0];
  const fields = firstRecord ? decodeFields(firstRecord) : [];
  const otherRecords = records.slice(1).map((r) => utf8.decode(r));
  return { fields, otherRecords };
}

const PHONE_LIKE = /^[0-9+\-()\s]+$/;

function deriveContactName(fields: string[], phone: string): string | undefined {
  // Observed shape: ["0","","","tel","<intl>","","<formatted>","<intl>",...].
  // A display name, if present, would be a non-empty non-phone field that isn't
  // the channel tag. We skip empty strings, "0"/"tel" markers, and anything
  // matching phone-like characters.
  for (const f of fields) {
    if (!f || f === '0' || f === 'tel' || f === phone) continue;
    if (PHONE_LIKE.test(f)) continue;
    return f;
  }
  return undefined;
}

function parseMeta(rec: TlvRecord): Meta {
  const baseOffset = rec.offset + TLV_HEADER_SIZE;
  const records = readCountedContainer(rec.content, ITEM_KEY_VALUE);
  const items = records.map((r) => decodeKeyValue(r, baseOffset));
  return { items, raw: toRawChunk(rec) };
}

function parseContacts(rec: TlvRecord): Contact[] {
  const baseOffset = rec.offset + TLV_HEADER_SIZE;
  const records = readCountedContainer(rec.content, ITEM_CONTACT);
  return records.map((r) => decodeContact(r, baseOffset));
}

/**
 * Parse a THREAD (type=0x0006) container.
 *
 * Verified layout of the 11-byte thread header (against the real 65MB backup):
 *   +0 (u32 LE): thread ID — sequential 1-based index matching the outer count
 *   +4 (u8):     flag byte — observed 0x00 or 0x01, meaning TBD
 *   +5 (u16 LE): always 0x0000 padding
 *   +7 (u32 LE): decoded payload size — equals the stored byte count for raw
 *                JPEG, and the inflated size for zlib-wrapped PNG/GIF.
 *
 * The body is a single stored media file: printable metadata (file name,
 * source locator, MIME) followed by the image bytes. See `readMediaHeader`.
 * The record carries no peer information; `assignThreadPeers` recovers that
 * from SETTINGS once every section has been read.
 */
function parseThread(rec: TlvRecord): Thread {
  if (rec.content.length < THREAD_HEADER_SIZE) {
    throw new Error(`thread content too short: ${rec.content.length}B`);
  }
  const r = new BinaryReader(rec.content, 0, rec.content.length);
  const threadId = r.readU32LE();
  const flag = r.readU8();
  const pad = r.readU16LE();
  if (pad !== 0) {
    throw new Error(`unexpected thread padding 0x${pad.toString(16)} at thread ${threadId}`);
  }
  const sizeField = r.readU32LE();
  const body = r.readBytes(r.remaining);
  const bodyAbsoluteOffset = rec.offset + TLV_HEADER_SIZE + THREAD_HEADER_SIZE;
  const media = readMediaHeader(body);

  const thread: Thread = {
    id: `thread-${threadId}`,
    threadId,
    isGroup: false,
    messageCount: 0,
    messages: [],
    unknownFields: [],
    raw: toRawChunk(rec),
    body,
    // Min 6 codepoints mirrors the previous ASCII-only guard; 500 is plenty
    // for a single thread while keeping the summary payload bounded.
    // Raised above the plain-UTF-8 validation minimum so short runs of random
    // binary that happen to decode (e.g. one stray kanji plus ASCII symbols)
    // don't flood the "取り出せたテキスト断片" list. The real message bodies
    // come from the structured inbox parser.
    strings: extractTextRuns(body, bodyAbsoluteOffset, { minCodepoints: 8, maxRuns: 500 }),
    attachments: scanAttachments(body, bodyAbsoluteOffset),
    headerFlag: flag,
    headerSizeField: sizeField,
  };
  if (media) thread.media = media;
  return thread;
}

function parseMessages(
  rec: TlvRecord,
  onProgress?: (p: ParseProgress) => void,
): Thread[] {
  // readCountedContainer yields records whose offsets are relative to the
  // container content. Rebase them to absolute file offsets so downstream
  // consumers (strings, summaries, hex jumps) see real positions.
  const baseOffset = rec.offset + TLV_HEADER_SIZE;
  const records = readCountedContainer(rec.content, SECTION_THREAD);
  const out: Thread[] = [];
  const total = records.length;
  const emitEvery = Math.max(1, Math.floor(total / 20)); // ~5% steps
  for (let i = 0; i < total; i += 1) {
    const rel = records[i]!;
    const abs: TlvRecord = { ...rel, offset: baseOffset + rel.offset };
    out.push(parseThread(abs));
    if (onProgress && (i % emitEvery === emitEvery - 1 || i === total - 1)) {
      onProgress({
        stage: 'threads',
        progress: 0.3 + 0.6 * ((i + 1) / total),
        note: `thread ${i + 1} / ${total}`,
      });
    }
  }
  return out;
}

export function parseBackup(
  buffer: Uint8Array,
  onProgress?: (p: ParseProgress) => void,
): Backup {
  const fileSize = buffer.byteLength;

  if (!isMagicAt(buffer, 0)) {
    throw new Error('not a PlusMessage backup: leading magic missing');
  }

  // Trailing magic: last 9 bytes are "wclBackup" as a closing sentinel.
  const hasTrailingMagic = isMagicAt(buffer, fileSize - MAGIC_BYTES.length);
  const logicalEnd = hasTrailingMagic ? fileSize - MAGIC_BYTES.length : fileSize;

  const reader = new BinaryReader(buffer, PREAMBLE_SIZE, logicalEnd);

  const sections: RawChunk[] = [];
  const unknownSections: RawChunk[] = [];
  let meta: Meta | undefined;
  const contacts: Contact[] = [];
  let settings: RawChunk | undefined;
  let inbox: InboxBucket[] | undefined;
  const threads: Thread[] = [];

  onProgress?.({ stage: 'scan', progress: 0.05, note: 'header' });

  for (const rec of iterateTlvs(reader)) {
    sections.push(toRawChunk(rec));
    switch (rec.type) {
      case SECTION_META:
        onProgress?.({ stage: 'meta', progress: 0.1 });
        meta = parseMeta(rec);
        break;
      case SECTION_CONTACTS:
        onProgress?.({ stage: 'contacts', progress: 0.2 });
        contacts.push(...parseContacts(rec));
        break;
      case SECTION_SETTINGS:
        settings = toRawChunk(rec);
        // SETTINGS is misnamed historically — the 0x0001 section actually
        // carries the SMS inbox store (per-peer message bodies, timestamps,
        // SIP metadata). Parse it structurally so the UI can show real text.
        try {
          inbox = parseInbox(rec);
        } catch {
          inbox = [];
        }
        break;
      case SECTION_MESSAGES:
        onProgress?.({ stage: 'threads', progress: 0.3 });
        threads.push(...parseMessages(rec, onProgress));
        break;
      case SECTION_END:
        break;
      default:
        unknownSections.push(toRawChunk(rec));
    }
  }

  // Media records and peer identities live in different sections, so the join
  // runs once every section has been read rather than inside the loop — the
  // ordering of SETTINGS vs MESSAGES is not something we want to depend on.
  let peerNames: Record<string, string> = {};
  if (settings) {
    const settingsContent = settings.bytes.subarray(TLV_HEADER_SIZE);
    assignThreadPeers(threads, settingsContent, findAllPeerIds(settingsContent));
    peerNames = extractPeerNames(settingsContent);
  }

  const bytesConsumed = reader.offset + (hasTrailingMagic ? MAGIC_BYTES.length : 0);

  const backup: Backup = {
    contacts,
    peerNames,
    threads,
    sections,
    unknownSections,
    bytesConsumed,
    fileSize,
    parserVersion: PARSER_VERSION,
  };
  if (meta) backup.meta = meta;
  if (settings) backup.settings = settings;
  if (inbox) backup.inbox = inbox;
  onProgress?.({ stage: 'done', progress: 1 });
  return backup;
}

/**
 * Convert the byte-heavy {@link Backup} into a lightweight {@link BackupSummary}
 * safe to ship across the Worker/main postMessage boundary. All `bytes`,
 * `body`, and `valueRaw` buffers are replaced with offset+length references;
 * consumers that need the actual bytes must resolve them against the main
 * buffer (or, later, via the Worker's slice API).
 */
export function summarizeBackup(backup: Backup): BackupSummary {
  const summarizeChunk = (c: RawChunk): RawChunkSummary => ({
    type: c.type,
    offset: c.offset,
    length: c.bytes.length,
  });

  const summarizeKv = (kv: KeyValueItem): KeyValueItemSummary => ({
    key: kv.key,
    valueUtf8: kv.valueUtf8,
    offset: kv.offset,
    length: kv.raw.length,
  });

  const summarizeMeta = (m: Meta): MetaSummary => ({
    items: m.items.map(summarizeKv),
    raw: summarizeChunk(m.raw),
  });

  const summarizeContact = (c: Contact): ContactSummary => {
    const out: ContactSummary = {
      raw: summarizeChunk(c.raw),
      phone: c.phone,
      fields: c.fields,
      otherRecords: c.otherRecords,
    };
    if (c.name !== undefined) out.name = c.name;
    return out;
  };

  const summarizeThread = (t: Thread): ThreadSummary => {
    // body is a subarray of the original buffer — recover its absolute offset
    // from the thread record offset + TLV header + 11-byte thread header.
    const bodyOffset = t.raw.offset + TLV_HEADER_SIZE + THREAD_HEADER_SIZE;
    const out: ThreadSummary = {
      id: t.id,
      threadId: t.threadId,
      isGroup: t.isGroup,
      messageCount: t.messageCount,
      raw: summarizeChunk(t.raw),
      bodyOffset,
      bodyLength: t.body.length,
      strings: t.strings,
      attachments: t.attachments,
      headerFlag: t.headerFlag,
      headerSizeField: t.headerSizeField,
    };
    if (t.peerId !== undefined) out.peerId = t.peerId;
    if (t.media !== undefined) out.media = t.media;
    return out;
  };

  const summary: BackupSummary = {
    contacts: backup.contacts.map(summarizeContact),
    peerNames: backup.peerNames,
    threads: backup.threads.map(summarizeThread),
    sections: backup.sections.map(summarizeChunk),
    unknownSections: backup.unknownSections.map(summarizeChunk),
    bytesConsumed: backup.bytesConsumed,
    fileSize: backup.fileSize,
    parserVersion: backup.parserVersion,
  };
  if (backup.meta) summary.meta = summarizeMeta(backup.meta);
  if (backup.settings) summary.settings = summarizeChunk(backup.settings);
  if (backup.inbox) summary.inbox = backup.inbox;
  return summary;
}
