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

export interface Attachment {
  kind: 'image/jpeg' | 'image/png' | 'unknown';
  stored: Uint8Array;
  contentType: string;
  sourceOffset: number;
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

export interface Thread {
  id: string;
  threadId: number;
  peerPhone?: string;
  isGroup: boolean;
  messageCount: number;
  messages: Message[];
  unknownFields: RawChunk[];
  raw: RawChunk;
  /** Thread-body bytes excluding the 11-byte thread header. */
  body: Uint8Array;
  /** Printable ASCII strings discovered inside the body (UUIDs, URLs, MIME types). */
  strings: ThreadString[];
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
  threads: Thread[];
  sections: RawChunk[];
  unknownSections: RawChunk[];
  bytesConsumed: number;
  fileSize: number;
  parserVersion: string;
}
