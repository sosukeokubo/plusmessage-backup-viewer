import { describe, expect, it } from 'vitest';
import { extractTextRuns } from '../src/parser/textRuns';

const encoder = new TextEncoder();

function bytes(...parts: Array<string | number[] | Uint8Array>): Uint8Array {
  const chunks = parts.map((p) => {
    if (typeof p === 'string') return encoder.encode(p);
    if (p instanceof Uint8Array) return p;
    return new Uint8Array(p);
  });
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

describe('extractTextRuns', () => {
  it('captures Japanese runs alongside ASCII', () => {
    const buf = bytes([0x00, 0x00], 'abc あいう def', [0x00]);
    const runs = extractTextRuns(buf, 0);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.text).toBe('abc あいう def');
    expect(runs[0]?.offset).toBe(2);
  });

  it('counts codepoints, not bytes, for the min length gate', () => {
    // "了解" is 2 codepoints / 6 bytes. minCodepoints=2 should keep it.
    const buf = bytes([0xff], '了解', [0xff]);
    const runs = extractTextRuns(buf, 100, { minCodepoints: 2 });
    expect(runs).toHaveLength(1);
    expect(runs[0]?.text).toBe('了解');
    expect(runs[0]?.offset).toBe(101);
    expect(runs[0]?.length).toBe(6);
  });

  it('drops runs shorter than minCodepoints', () => {
    const buf = bytes('a', [0x00], 'abcdef');
    const runs = extractTextRuns(buf, 0, { minCodepoints: 6 });
    expect(runs.map((r) => r.text)).toEqual(['abcdef']);
  });

  it('rejects UTF-8 surrogate encodings and over-long sequences', () => {
    // 0xED 0xA0 0x80 would decode to U+D800 (surrogate) — must be rejected.
    const surrogate = new Uint8Array([0xed, 0xa0, 0x80]);
    // 0xC0 0xAE is an over-long encoding of '.' — must be rejected.
    const overlong = new Uint8Array([0xc0, 0xae]);
    const buf = bytes('valid text', surrogate, overlong, 'tail tail');
    const runs = extractTextRuns(buf, 0, { minCodepoints: 2 });
    expect(runs.map((r) => r.text)).toEqual(['valid text', 'tail tail']);
  });

  it('honours maxRuns', () => {
    const buf = bytes('abc', [0x00], 'def', [0x00], 'ghi');
    const runs = extractTextRuns(buf, 0, { minCodepoints: 2, maxRuns: 2 });
    expect(runs.map((r) => r.text)).toEqual(['abc', 'def']);
  });

  it('skips a single unreadable byte and keeps scanning', () => {
    const buf = bytes('hello', [0x00, 0x01, 0x02], 'world');
    const runs = extractTextRuns(buf, 0, { minCodepoints: 2 });
    expect(runs.map((r) => r.text)).toEqual(['hello', 'world']);
  });
});
