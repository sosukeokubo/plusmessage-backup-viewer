import { BinaryReader } from './BinaryReader';
import { TLV_HEADER_SIZE } from './constants';
import type { TlvRecord } from './types';

/**
 * PlusMessage TLV header layout (10 bytes, little-endian):
 *   type:       u16 LE
 *   field1:     u32 LE   (top-level: always 4; inner 0x000c records: equals content size)
 *   contentLen: u32 LE
 * Followed by `contentLen` bytes of payload.
 *
 * Determined empirically against real 65MB backup — see day-1 verification in the plan.
 */
export function readTlv(r: BinaryReader): TlvRecord {
  const startOffset = r.offset;
  if (r.remaining < TLV_HEADER_SIZE) {
    throw new Error(
      `TLV header underflow at 0x${startOffset.toString(16)}: need ${TLV_HEADER_SIZE}, have ${r.remaining}`,
    );
  }
  const type = r.readU16LE();
  const field1 = r.readU32LE();
  const contentLen = r.readU32LE();

  if (contentLen > r.remaining) {
    throw new Error(
      `TLV content underflow at 0x${startOffset.toString(16)}: type=0x${type
        .toString(16)
        .padStart(4, '0')} contentLen=${contentLen} remaining=${r.remaining}`,
    );
  }

  const content = r.readBytes(contentLen);
  const totalLen = TLV_HEADER_SIZE + contentLen;
  const raw = r.buffer.subarray(startOffset, startOffset + totalLen);

  return { type, offset: startOffset, field1, contentLen, content, raw };
}

export function* iterateTlvs(r: BinaryReader): Generator<TlvRecord> {
  while (r.remaining >= TLV_HEADER_SIZE) {
    yield readTlv(r);
  }
}

/** Iterate 0x000c key-value items inside a META/CONTACT-like container. */
export function* iterateKeyValues(
  r: BinaryReader,
): Generator<TlvRecord> {
  for (const rec of iterateTlvs(r)) {
    yield rec;
  }
}
