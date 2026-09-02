import { deflate } from 'pako';
import { describe, expect, it } from 'vitest';
import { findJpegEnd, scanAttachments, scanJpegs, scanZlibImages } from '../src/parser';

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
      encoding: 'raw',
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

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const GIF89A_SIGNATURE = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
const GIF87A_SIGNATURE = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x37, 0x61]);

/**
 * Build a byte stream that starts with `signature` and is padded with
 * deterministic filler. The image's internal validity doesn't matter for
 * scanZlibImages — it only checks the leading magic bytes. The filler gives
 * deflate real input to chew on so we get a nontrivial zlib stream.
 */
function miniImage(signature: Uint8Array): Uint8Array {
  const filler = new Uint8Array(64);
  for (let i = 0; i < filler.length; i += 1) filler[i] = i & 0xff;
  const out = new Uint8Array(signature.length + filler.length);
  out.set(signature, 0);
  out.set(filler, signature.length);
  return out;
}

const miniPng = () => miniImage(PNG_SIGNATURE);

describe('scanZlibImages', () => {
  it('detects a zlib-wrapped PNG embedded in a larger buffer', () => {
    const png = miniPng();
    const zlib = deflate(png); // pako's zlib-wrapped deflate
    const prefix = new Uint8Array([0x00, 0x11, 0x22]);
    const body = new Uint8Array(prefix.length + zlib.length + 4);
    body.set(prefix, 0);
    body.set(zlib, prefix.length);
    body.set([0xde, 0xad, 0xbe, 0xef], prefix.length + zlib.length);

    const refs = scanZlibImages(body, 0x2000);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toEqual({
      kind: 'image/png',
      contentType: 'image/png',
      sourceOffset: 0x2000 + prefix.length,
      length: zlib.length,
      encoding: 'zlib',
      decompressedLength: png.length,
    });
  });

  // Regression: the real 62MB backup stores 12 GIF attachments this way and
  // they were all dropped while only the PNG signature was accepted.
  it.each([
    ['GIF89a', GIF89A_SIGNATURE],
    ['GIF87a', GIF87A_SIGNATURE],
  ])('detects a zlib-wrapped %s image', (_label, signature) => {
    const gif = miniImage(signature);
    const zlib = deflate(gif);
    const prefix = new Uint8Array([0x00, 0x11, 0x22]);
    const body = new Uint8Array(prefix.length + zlib.length);
    body.set(prefix, 0);
    body.set(zlib, prefix.length);

    const refs = scanZlibImages(body, 0x3000);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toEqual({
      kind: 'image/gif',
      contentType: 'image/gif',
      sourceOffset: 0x3000 + prefix.length,
      length: zlib.length,
      encoding: 'zlib',
      decompressedLength: gif.length,
    });
  });

  it('rejects a GIF8-prefixed payload whose version bytes are not 87a/89a', () => {
    const fake = miniImage(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x35, 0x61])); // "GIF85a"
    expect(scanZlibImages(deflate(fake), 0)).toEqual([]);
  });

  it('skips candidate bytes whose CMF/FLG does not satisfy the zlib checksum rule', () => {
    // 0x78 followed by a byte that fails (cmf*256 + flg) % 31 === 0.
    // 0x78 * 256 + 0x00 = 30720, 30720 % 31 = 29 → not a zlib header.
    const body = new Uint8Array([0x78, 0x00, 0x78, 0x01, 0x02, 0x78, 0xff]);
    expect(scanZlibImages(body, 0)).toEqual([]);
  });

  it('rejects a valid zlib stream whose inflated payload is not a known image', () => {
    const notImage = new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09]);
    const zlib = deflate(notImage);
    expect(scanZlibImages(zlib, 0)).toEqual([]);
  });

  it('finds multiple back-to-back zlib image streams of different formats', () => {
    const a = deflate(miniPng());
    const b = deflate(miniImage(GIF89A_SIGNATURE));
    const body = new Uint8Array(a.length + b.length);
    body.set(a, 0);
    body.set(b, a.length);

    const refs = scanZlibImages(body, 0);
    expect(refs).toHaveLength(2);
    expect(refs[0]?.kind).toBe('image/png');
    expect(refs[0]?.sourceOffset).toBe(0);
    expect(refs[0]?.length).toBe(a.length);
    expect(refs[1]?.kind).toBe('image/gif');
    expect(refs[1]?.sourceOffset).toBe(a.length);
    expect(refs[1]?.length).toBe(b.length);
  });
});

describe('scanAttachments', () => {
  it('merges raw-JPEG and zlib-image hits in offset order', () => {
    const jpeg = miniJpeg();
    const zlib = deflate(miniPng());
    // Layout: [pad] [jpeg] [pad] [zlib] [pad]
    const pad = new Uint8Array([0x00, 0x00]);
    const body = new Uint8Array(pad.length + jpeg.length + pad.length + zlib.length + pad.length);
    let off = 0;
    body.set(pad, off);
    off += pad.length;
    const jpegOff = off;
    body.set(jpeg, off);
    off += jpeg.length;
    body.set(pad, off);
    off += pad.length;
    const zlibOff = off;
    body.set(zlib, off);

    const refs = scanAttachments(body, 0);
    expect(refs).toHaveLength(2);
    expect(refs[0]?.kind).toBe('image/jpeg');
    expect(refs[0]?.sourceOffset).toBe(jpegOff);
    expect(refs[1]?.kind).toBe('image/png');
    expect(refs[1]?.sourceOffset).toBe(zlibOff);
  });
});
