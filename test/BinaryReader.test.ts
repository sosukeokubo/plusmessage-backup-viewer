import { describe, expect, it } from 'vitest';
import { BinaryReader, EndOfBufferError } from '../src/parser/BinaryReader';

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

describe('BinaryReader', () => {
  it('reads unsigned integers in both endiannesses', () => {
    const r = new BinaryReader(bytes(0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0));
    expect(r.readU16LE()).toBe(0x3412);
    expect(r.readU16BE()).toBe(0x5678);
    expect(r.readU32LE()).toBe(0xf0debc9a);
    expect(r.eof).toBe(true);
  });

  it('readBytes returns a zero-copy subarray of the underlying buffer', () => {
    const buf = bytes(1, 2, 3, 4, 5);
    const r = new BinaryReader(buf);
    const slice = r.readBytes(3);
    expect(slice).toEqual(bytes(1, 2, 3));
    expect(slice.buffer).toBe(buf.buffer);
  });

  it('sliceReader yields a child cursor that does not advance the parent past its end', () => {
    const r = new BinaryReader(bytes(0, 1, 2, 3, 4, 5, 6, 7));
    r.skip(2);
    const child = r.sliceReader(4);
    expect(child.readU8()).toBe(2);
    expect(child.readU8()).toBe(3);
    expect(r.offset).toBe(6);
    expect(r.readU8()).toBe(6);
  });

  it('throws EndOfBufferError on overrun with useful context', () => {
    const r = new BinaryReader(bytes(1, 2, 3));
    r.skip(2);
    expect(() => r.readU32LE()).toThrow(EndOfBufferError);
    try {
      r.readU32LE();
    } catch (err) {
      const e = err as EndOfBufferError;
      expect(e.offset).toBe(2);
      expect(e.need).toBe(4);
      expect(e.have).toBe(1);
    }
  });

  it('reads signed 64-bit integers', () => {
    const buf = new Uint8Array(8);
    new DataView(buf.buffer).setBigInt64(0, -1n, true);
    expect(new BinaryReader(buf).readI64LE()).toBe(-1n);
    new DataView(buf.buffer).setBigInt64(0, 0x0102030405060708n, false);
    expect(new BinaryReader(buf).readI64BE()).toBe(0x0102030405060708n);
  });

  it('decodes UTF-8 and ASCII substrings', () => {
    const encoder = new TextEncoder();
    const payload = encoder.encode('héllo');
    const r = new BinaryReader(payload);
    expect(r.readUtf8(payload.length)).toBe('héllo');

    const r2 = new BinaryReader(new Uint8Array([0x41, 0x42, 0x43]));
    expect(r2.readAscii(3)).toBe('ABC');
  });
});
