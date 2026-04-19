import { describe, expect, it } from 'vitest';
import { findJpegEnd, scanJpegs } from '../src/parser';

/**
 * Build a well-formed (walker-wise) JPEG stream. Pixel data is nonsense but
 * the marker framing is valid — that's what `findJpegEnd` cares about.
 */
function miniJpeg(entropy: number[] = [0xaa, 0xbb, 0xff, 0x00, 0x11]): Uint8Array {
  const app0Len = 16;
  const sosHeaderLen = 12;
  const bytes: number[] = [];
  bytes.push(0xff, 0xd8); // SOI
  bytes.push(0xff, 0xe0); // APP0
  bytes.push((app0Len >> 8) & 0xff, app0Len & 0xff);
  for (let i = 0; i < app0Len - 2; i += 1) bytes.push(0x00);
  bytes.push(0xff, 0xda); // SOS
  bytes.push((sosHeaderLen >> 8) & 0xff, sosHeaderLen & 0xff);
  for (let i = 0; i < sosHeaderLen - 2; i += 1) bytes.push(0x00);
  for (const b of entropy) bytes.push(b);
  bytes.push(0xff, 0xd9); // EOI
  return new Uint8Array(bytes);
}

describe('findJpegEnd', () => {
  it('returns the exclusive EOI offset for a simple JPEG', () => {
    const jpeg = miniJpeg();
    const end = findJpegEnd(jpeg, 0);
    expect(end).toBe(jpeg.length);
  });

  it('walks past SOS entropy data that contains 0xFF00 escapes and RST markers', () => {
    // 0xFF 0x00 = escaped data byte, 0xFF 0xD3 = RST3 (continue scan)
    const entropy = [0xaa, 0xff, 0x00, 0x55, 0xff, 0xd3, 0x99, 0xff, 0x00];
    const jpeg = miniJpeg(entropy);
    const end = findJpegEnd(jpeg, 0);
    expect(end).toBe(jpeg.length);
  });

  it('returns null if SOI is missing', () => {
    const junk = new Uint8Array([0x12, 0x34, 0x56]);
    expect(findJpegEnd(junk, 0)).toBeNull();
  });

  it('returns null if the stream is truncated before EOI', () => {
    const jpeg = miniJpeg().slice(0, -1); // drop the D9
    expect(findJpegEnd(jpeg, 0)).toBeNull();
  });
});

describe('scanJpegs', () => {
  it('finds a single JPEG embedded in a larger buffer and records its absolute offset', () => {
    const jpeg = miniJpeg();
    const prefix = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04]);
    const body = new Uint8Array(prefix.length + jpeg.length + 3);
    body.set(prefix, 0);
    body.set(jpeg, prefix.length);
    // trailing noise after the JPEG
    body.set([0xde, 0xad, 0xbe], prefix.length + jpeg.length);

    const refs = scanJpegs(body, 0x1000);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toEqual({
      kind: 'image/jpeg',
      contentType: 'image/jpeg',
      sourceOffset: 0x1000 + prefix.length,
      length: jpeg.length,
    });
  });

  it('finds multiple back-to-back JPEGs', () => {
    const a = miniJpeg([0x01, 0x02, 0x03]);
    const b = miniJpeg([0x99, 0x88]);
    const body = new Uint8Array(a.length + b.length);
    body.set(a, 0);
    body.set(b, a.length);

    const refs = scanJpegs(body, 0);
    expect(refs).toHaveLength(2);
    expect(refs[0]?.sourceOffset).toBe(0);
    expect(refs[0]?.length).toBe(a.length);
    expect(refs[1]?.sourceOffset).toBe(a.length);
    expect(refs[1]?.length).toBe(b.length);
  });

  it('ignores lone 0xFF 0xD8 bytes that are not JPEG SOI (need FF D8 FF)', () => {
    const body = new Uint8Array([0xff, 0xd8, 0x55, 0xff, 0xd8, 0x00, 0x11]);
    expect(scanJpegs(body, 0)).toEqual([]);
  });

  it('ignores an FF D8 FF prefix that does not walk to a valid EOI', () => {
    // Truncated: starts like a JPEG but bails out midway.
    const body = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00]);
    expect(scanJpegs(body, 0)).toEqual([]);
  });
});
