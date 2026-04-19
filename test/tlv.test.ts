import { describe, expect, it } from 'vitest';
import { BinaryReader } from '../src/parser/BinaryReader';
import { iterateTlvs, readTlv } from '../src/parser/tlv';

function buildTlv(type: number, content: Uint8Array, field1 = 4): Uint8Array {
  const out = new Uint8Array(10 + content.length);
  const view = new DataView(out.buffer);
  view.setUint16(0, type, true);
  view.setUint32(2, field1, true);
  view.setUint32(6, content.length, true);
  out.set(content, 10);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

describe('readTlv', () => {
  it('parses a single record with 10-byte header and LE lengths', () => {
    const content = new Uint8Array([0xaa, 0xbb, 0xcc]);
    const bytes = buildTlv(0x000b, content);
    const rec = readTlv(new BinaryReader(bytes));
    expect(rec.type).toBe(0x000b);
    expect(rec.field1).toBe(4);
    expect(rec.contentLen).toBe(3);
    expect(rec.content).toEqual(content);
    expect(rec.raw.length).toBe(bytes.length);
  });

  it('throws when content length exceeds remaining buffer', () => {
    // header says contentLen=10 but buffer only has 5 payload bytes
    const header = new Uint8Array(10);
    new DataView(header.buffer).setUint16(0, 0x0005, true);
    new DataView(header.buffer).setUint32(2, 4, true);
    new DataView(header.buffer).setUint32(6, 10, true);
    const bytes = concat(header, new Uint8Array(5));
    expect(() => readTlv(new BinaryReader(bytes))).toThrow(/content underflow/);
  });
});

describe('iterateTlvs', () => {
  it('walks every section in order and emits correct offsets', () => {
    const a = buildTlv(0x000b, new Uint8Array([1, 2, 3]));
    const b = buildTlv(0x000d, new Uint8Array([4, 5]));
    const c = buildTlv(0x0008, new Uint8Array(0));
    const stream = concat(a, b, c);

    const records = Array.from(iterateTlvs(new BinaryReader(stream)));
    expect(records.map((r) => r.type)).toEqual([0x000b, 0x000d, 0x0008]);
    expect(records.map((r) => r.offset)).toEqual([0, a.length, a.length + b.length]);
    expect(records.map((r) => r.contentLen)).toEqual([3, 2, 0]);
  });
});
