export interface RawChunk {
  type: number;
  offset: number;
  bytes: Uint8Array;
}

export interface TlvRecord {
  type: number;
  offset: number;
  field1: number;
  contentLen: number;
  content: Uint8Array;
  raw: Uint8Array;
}

export interface KeyValueItem {
  key: string;
  value: Uint8Array;
  valueUtf8: string;
  offset: number;
  raw: Uint8Array;
}

export interface Meta {
  items: KeyValueItem[];
  raw: RawChunk;
}

export interface Contact {
  raw: RawChunk;
  phone: string;
  name?: string;
  fields: string[];
  otherRecords: string[];
  valueRaw: Uint8Array;
  tail: Uint8Array;
}

/**
 * Metadata that opens a THREAD (0x0006) body — see `readMediaHeader` in
 * media.ts for the byte layout.
 */
export interface MediaHeader {
  /** Resource UUID for downloaded content, or the original file name. */
  name: string;
  /** `0,`-prefixed source locator: an https URL, `app://photos-kit/…`, or a path. */
  sourcePath: string;
  contentType: string;
  /**
   * Bytes consumed by the three text fields. The 0x0007 tag and the size
   * fields still follow before the image bytes, so this is not the payload
   * offset — attachments are located by signature scan, not from here.
   */
  headerLength: number;
}

export interface Attachment {
  kind: 'image/jpeg' | 'image/png' | 'image/gif' | 'unknown';
  stored: Uint8Array;
  contentType: string;
  sourceOffset: number;
}

/**
 * Tokenised attachment reference — offset + length into the backup buffer,
 * not the bytes themselves. The UI resolves these lazily via the Worker when
 * a thumbnail scrolls into view.
 *
 * `encoding` tells the Worker how to materialise the bytes:
 *   - 'raw'   — slice [sourceOffset, sourceOffset+length) as-is.
 *   - 'zlib'  — slice, then pako.inflate to recover the image stream. The
 *               decoded format (PNG, GIF) is carried by `contentType`, not by
 *               the encoding, since inflating is identical either way.
 *
 * `decompressedLength` is the size the UI should expect after decoding
 * (equals `length` for raw attachments).
 */
export interface AttachmentRef {
  kind: 'image/jpeg' | 'image/png' | 'image/gif' | 'unknown';
  contentType: string;
  sourceOffset: number;
  length: number;
  encoding: 'raw' | 'zlib';
  decompressedLength?: number;
}

export interface Message {
  id: string;
  text?: string;
  attachments: Attachment[];
  timestamp?: {
    raw: Uint8Array;
    iso?: string;
    confidence: 'guess' | 'likely' | 'known';
  };
  direction: 'incoming' | 'outgoing' | 'unknown';
  peer?: string;
  unknownFields: RawChunk[];
  raw: RawChunk;
}

/**
 * A single message record reconstructed from the SMS inbox store (section
 * type 0x0001). Layout — verified against the real 62MB backup:
 *
 *   [20B anchor: 07000000 01000000 00000000 05000000 00000000]
 *   [u64 LE: timestamp ms]
 *   [u32 LE: textLen][text bytes]
 *   [u32 LE: mimeLen][mime string, e.g. "text/plain;charset=utf-8"]
 *   [u32 LE: uuidLen][uuid string]
 *   [u32 LE: sipLen][sip metadata string]
 *   [40B trailer including a repeat of the timestamp]
 *
 * Direction can't be recovered from this backup — every SIP From/To is
 * `<sip:anonymous@anonymous.invalid>` and the pipe-delimited flags are
 * constant `1|1|0|`. We default to 'unknown' and let the UI treat the whole
 * list as received messages for now.
 */
export interface InboxMessage {
  id: string;
  peerId: string;
  text: string;
  mimeType: string;
  timestamp: { ms: number; iso: string };
  direction: 'incoming' | 'outgoing' | 'unknown';
  sipMetadata: string;
  offset: number;
  length: number;
}

/**
 * Messages grouped by peer. `peerId` is a `+81…` phone for a person, or a
 * service address such as `operator@kw.ncs.spmode.ne.jp` for carrier
 * notifications and the docomo official account.
 */
export interface InboxBucket {
  peerId: string;
  messages: InboxMessage[];
  offset: number;
  length: number;
}

/**
 * One THREAD (0x0006) record. Despite the name this is a single stored media
 * file, not a conversation — the peer it belongs to is recovered afterwards
 * by looking `media.name` up in SETTINGS (see `assignThreadPeers`).
 */
export interface Thread {
  id: string;
  threadId: number;
  peerId?: string;
  /** File name / source / MIME decoded from the head of the body. */
  media?: MediaHeader;
  isGroup: boolean;
  messageCount: number;
  messages: Message[];
  unknownFields: RawChunk[];
  raw: RawChunk;
  /** Thread-body bytes excluding the 11-byte thread header. */
  body: Uint8Array;
  /** Printable ASCII strings discovered inside the body (UUIDs, URLs, MIME types). */
  strings: ThreadString[];
  /** Attachments discovered inside the thread body (raw JPEG, zlib-wrapped PNG/GIF). */
  attachments: AttachmentRef[];
  /** Unresolved bytes in the thread header (flag + size-like u32). */
  headerFlag: number;
  headerSizeField: number;
}

export interface ThreadString {
  offset: number;
  length: number;
  text: string;
}

export interface Backup {
  meta?: Meta;
  contacts: Contact[];
  settings?: RawChunk;
  inbox?: InboxBucket[];
  /** Display names recovered from SETTINGS, keyed by peer id. */
  peerNames: Record<string, string>;
  threads: Thread[];
  sections: RawChunk[];
  unknownSections: RawChunk[];
  bytesConsumed: number;
  fileSize: number;
  parserVersion: string;
}

/**
 * Lightweight structural summaries sent from the parser Worker to the main
 * thread. Everything that would otherwise duplicate the file buffer (bytes
 * carried on RawChunk, Thread.body, Contact.valueRaw, etc.) is dropped here
 * — the UI only needs type/offset/length and the small derived fields. When
 * the UI needs raw bytes (hex view, attachments), it asks the Worker for a
 * slice via offset+length.
 */
export interface RawChunkSummary {
  type: number;
  offset: number;
  length: number;
}

export interface KeyValueItemSummary {
  key: string;
  valueUtf8: string;
  offset: number;
  length: number;
}

export interface MetaSummary {
  items: KeyValueItemSummary[];
  raw: RawChunkSummary;
}

export interface ContactSummary {
  raw: RawChunkSummary;
  phone: string;
  name?: string;
  fields: string[];
  otherRecords: string[];
}

export interface ThreadSummary {
  id: string;
  threadId: number;
  peerId?: string;
  media?: MediaHeader;
  isGroup: boolean;
  messageCount: number;
  raw: RawChunkSummary;
  bodyOffset: number;
  bodyLength: number;
  strings: ThreadString[];
  attachments: AttachmentRef[];
  headerFlag: number;
  headerSizeField: number;
}

export interface BackupSummary {
  meta?: MetaSummary;
  contacts: ContactSummary[];
  settings?: RawChunkSummary;
  inbox?: InboxBucket[];
  peerNames: Record<string, string>;
  threads: ThreadSummary[];
  sections: RawChunkSummary[];
  unknownSections: RawChunkSummary[];
  bytesConsumed: number;
  fileSize: number;
  parserVersion: string;
}

export interface ParseProgress {
  stage: 'scan' | 'meta' | 'contacts' | 'threads' | 'summarize' | 'done';
  progress: number; // 0.0 – 1.0
  note?: string;
}
