export const MAGIC = 'wclBackup';
export const MAGIC_BYTES = new Uint8Array([0x77, 0x63, 0x6c, 0x42, 0x61, 0x63, 0x6b, 0x75, 0x70]);

export const PREAMBLE_SIZE = 0x7e;

export const TLV_HEADER_SIZE = 10;

export const SECTION_SETTINGS = 0x0001;
export const SECTION_MESSAGES = 0x0005;
export const SECTION_THREAD = 0x0006;
export const SECTION_END = 0x0008;
export const SECTION_META = 0x000b;
export const SECTION_CONTACTS = 0x000d;

export const ITEM_KEY_VALUE = 0x000c;
export const ITEM_CONTACT = 0x000e;

/** Records nested inside SETTINGS — see `parseSettings`. */
export const ITEM_PEER_BUCKET = 0x0002;
export const ITEM_CONVERSATION = 0x0003;
export const ITEM_BUCKET_END = 0x0004;

/** Bytes a peer bucket header spends on everything but the peer id itself. */
export const PEER_HEADER_FIXED_SIZE = 44;

/** `A` field of a 0x0003 record: 0 = text message, 4 = media delivery. */
export const CONVERSATION_TEXT = 0;
export const CONVERSATION_MEDIA = 4;

export const CONTACT_TAIL_SIZE = 20;

export const THREAD_HEADER_SIZE = 11;

export const GS = 0x1d;
export const RS = 0x1e;

export const SECTION_NAMES: Record<number, string> = {
  [SECTION_SETTINGS]: 'SETTINGS',
  [SECTION_MESSAGES]: 'MESSAGES',
  [SECTION_THREAD]: 'THREAD',
  [SECTION_END]: 'END',
  [SECTION_META]: 'META',
  [SECTION_CONTACTS]: 'CONTACTS',
  [ITEM_KEY_VALUE]: 'KEY_VALUE',
  [ITEM_CONTACT]: 'CONTACT',
  [ITEM_PEER_BUCKET]: 'PEER_BUCKET',
  [ITEM_CONVERSATION]: 'CONVERSATION',
  [ITEM_BUCKET_END]: 'BUCKET_END',
};

export const PARSER_VERSION = '0.1.0';
