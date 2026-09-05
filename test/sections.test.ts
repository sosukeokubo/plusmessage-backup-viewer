import { describe, expect, it } from 'vitest';
import {
  CONTACT_TAIL_SIZE,
  GS,
  ITEM_CONTACT,
  ITEM_KEY_VALUE,
  MAGIC_BYTES,
  PREAMBLE_SIZE,
  RS,
  SECTION_CONTACTS,
  SECTION_END,
  SECTION_MESSAGES,
  SECTION_META,
  SECTION_THREAD,
} from '../src/parser/constants';
import { parseBackup, summarizeBackup } from '../src/parser';
import type { ParseProgress } from '../src/parser/types';

function u32le(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
}

function u16le(n: number): Uint8Array {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, n, true);
  return b;
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

function ascii(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function tlv(type: number, content: Uint8Array, field1 = 4): Uint8Array {
  return concat(u16le(type), u32le(field1), u32le(content.length), content);
}

function kvItem(key: string, value: string): Uint8Array {
  const k = ascii(key);
  const v = ascii(value);
  const content = concat(u32le(k.length), k, u32le(v.length), v);
  return tlv(ITEM_KEY_VALUE, content, content.length);
}

function contactItem(phone: string, valueBlob: Uint8Array, tail: Uint8Array): Uint8Array {
  const p = ascii(phone);
  const content = concat(u32le(p.length), p, u32le(valueBlob.length), valueBlob, tail);
  return tlv(ITEM_CONTACT, content, content.length);
}

function buildMinimalBackup(sections: Uint8Array[]): Uint8Array {
  const preamble = new Uint8Array(PREAMBLE_SIZE);
  preamble.set(MAGIC_BYTES, 0);
  const body = concat(...sections);
  const end = tlv(SECTION_END, u32le(0));
  return concat(preamble, body, end, MAGIC_BYTES);
}

describe('parseBackup — META', () => {
  it('decodes the 4-byte item count prefix and all KV items', () => {
    const meta = tlv(
      SECTION_META,
      concat(u32le(2), kvItem('backup_owner', '+819012340000'), kvItem('k2', 'v2')),
    );
    const bytes = buildMinimalBackup([meta]);
    const backup = parseBackup(bytes);

    expect(backup.meta?.items).toHaveLength(2);
    expect(backup.meta?.items[0]?.key).toBe('backup_owner');
    expect(backup.meta?.items[0]?.valueUtf8).toBe('+819012340000');
    expect(backup.meta?.items[1]?.key).toBe('k2');
    expect(backup.bytesConsumed).toBe(bytes.length);
  });

  it('throws if the inner type is not 0x000c', () => {
    const badInner = tlv(0x0099, new Uint8Array(0));
    const meta = tlv(SECTION_META, concat(u32le(1), badInner));
    expect(() => parseBackup(buildMinimalBackup([meta]))).toThrow(/unexpected inner type/);
  });
});

describe('parseBackup — CONTACTS', () => {
  const tail = new Uint8Array(CONTACT_TAIL_SIZE);
  tail[8] = 0x01; // observed flag byte

  it('parses each contact and exposes phone + raw value blob + tail', () => {
    const blob = concat(
      ascii('0'),
      new Uint8Array([GS, GS, GS]),
      ascii('tel'),
      new Uint8Array([GS]),
      ascii('+819012345678'),
      new Uint8Array([RS]),
      ascii('+819012345678'),
      new Uint8Array([RS]),
    );
    const contacts = tlv(
      SECTION_CONTACTS,
      concat(u32le(1), contactItem('+819012345678', blob, tail)),
    );
    const bytes = buildMinimalBackup([contacts]);
    const backup = parseBackup(bytes);

    expect(backup.contacts).toHaveLength(1);
    const c = backup.contacts[0]!;
    expect(c.phone).toBe('+819012345678');
    expect(c.fields).toEqual(['0', '', '', 'tel', '+819012345678']);
    expect(c.otherRecords).toEqual(['+819012345678', '']);
    expect(c.tail).toEqual(tail);
    expect(c.name).toBeUndefined();
  });

  it('derives a display name when a non-phone field is present', () => {
    const blob = concat(
      ascii('0'),
      new Uint8Array([GS, GS, GS]),
      ascii('tel'),
      new Uint8Array([GS]),
      ascii('+81900000000'),
      new Uint8Array([GS]),
      ascii('山田 太郎'),
      new Uint8Array([RS]),
    );
    const contacts = tlv(
      SECTION_CONTACTS,
      concat(u32le(1), contactItem('+81900000000', blob, tail)),
    );
    const backup = parseBackup(buildMinimalBackup([contacts]));
    expect(backup.contacts[0]?.name).toBe('山田 太郎');
  });

  it('throws when tail size does not match', () => {
    const blob = new Uint8Array(0);
    const badTail = new Uint8Array(CONTACT_TAIL_SIZE - 1);
    const contacts = tlv(
      SECTION_CONTACTS,
      concat(u32le(1), contactItem('+819012345678', blob, badTail)),
    );
    expect(() => parseBackup(buildMinimalBackup([contacts]))).toThrow(/tail size mismatch/);
  });
});

describe('parseBackup — THREAD', () => {
  function threadRecord(id: number, flag: number, sizeField: number, body: Uint8Array): Uint8Array {
    const header = concat(u32le(id), new Uint8Array([flag]), u16le(0), u32le(sizeField));
    return tlv(SECTION_THREAD, concat(header, body));
  }

  it('decodes the thread count prefix and each 11-byte header', () => {
    const body0 = ascii('HELLO world 12345678');
    const body1 = ascii('xx uuid-like aaaaaa-bbbb-cccc ...');
    const messages = tlv(
      SECTION_MESSAGES,
      concat(u32le(2), threadRecord(1, 0x01, 999, body0), threadRecord(2, 0x00, 42, body1)),
    );
    const backup = parseBackup(buildMinimalBackup([messages]));

    expect(backup.threads).toHaveLength(2);
    expect(backup.threads[0]?.threadId).toBe(1);
    expect(backup.threads[0]?.id).toBe('thread-1');
    expect(backup.threads[0]?.headerFlag).toBe(0x01);
    expect(backup.threads[0]?.headerSizeField).toBe(999);
    expect(Array.from(backup.threads[0]?.body ?? [])).toEqual(Array.from(body0));

    expect(backup.threads[1]?.threadId).toBe(2);
    expect(backup.threads[1]?.headerFlag).toBe(0x00);
    expect(backup.threads[1]?.headerSizeField).toBe(42);
  });

  it('extracts printable strings ≥ 8 chars from the thread body', () => {
    const body = concat(
      new Uint8Array([0x00, 0x01, 0x02]),
      ascii('short7!'), // 7 chars, skipped
      new Uint8Array([0xff]),
      ascii('ABCDEFGH'), // 8 chars, kept
      new Uint8Array([0x00, 0x00]),
      ascii('uuid-1234'), // 9 chars, kept
    );
    const messages = tlv(SECTION_MESSAGES, concat(u32le(1), threadRecord(7, 0x01, 0, body)));
    const backup = parseBackup(buildMinimalBackup([messages]));
    const strings = backup.threads[0]?.strings ?? [];
    expect(strings.map((s) => s.text)).toEqual(['ABCDEFGH', 'uuid-1234']);
    expect(strings[0]?.length).toBe(8);
  });

  it('emits progress events for each thread with monotonic progress', () => {
    const body = ascii('xx aaaaaa ');
    const messages = tlv(
      SECTION_MESSAGES,
      concat(
        u32le(3),
        threadRecord(1, 0x00, 0, body),
        threadRecord(2, 0x00, 0, body),
        threadRecord(3, 0x00, 0, body),
      ),
    );
    const events: ParseProgress[] = [];
    parseBackup(buildMinimalBackup([messages]), (p) => events.push(p));
    expect(events.length).toBeGreaterThan(0);
    expect(events[events.length - 1]?.stage).toBe('done');
    const progresses = events.map((e) => e.progress);
    for (let i = 1; i < progresses.length; i += 1) {
      expect(progresses[i]!).toBeGreaterThanOrEqual(progresses[i - 1]!);
    }
  });

  it('summarizeBackup drops bytes/body but keeps offset+length references', () => {
    const body = ascii('aaaaaa-bbbbbb');
    const messages = tlv(SECTION_MESSAGES, concat(u32le(1), threadRecord(42, 0x01, 99, body)));
    const bytes = buildMinimalBackup([messages]);
    const backup = parseBackup(bytes);
    const summary = summarizeBackup(backup);

    expect(summary.threads).toHaveLength(1);
    const t0 = summary.threads[0]!;
    expect(t0.threadId).toBe(42);
    expect(t0.bodyLength).toBe(body.length);
    expect(t0.headerFlag).toBe(0x01);
    expect(t0.headerSizeField).toBe(99);
    // bodyOffset should point into the original buffer at the thread body.
    const slice = bytes.subarray(t0.bodyOffset, t0.bodyOffset + t0.bodyLength);
    expect(Array.from(slice)).toEqual(Array.from(body));

    // sections carry length but no bytes.
    for (const s of summary.sections) {
      expect(typeof s.length).toBe('number');
      expect((s as unknown as { bytes?: unknown }).bytes).toBeUndefined();
    }
  });

  it('throws when a thread has non-zero padding', () => {
    // padding byte at offset +5..+6 must be 0x0000
    const header = concat(u32le(1), new Uint8Array([0x01]), u16le(0x1234), u32le(0));
    const bad = tlv(SECTION_THREAD, header);
    const messages = tlv(SECTION_MESSAGES, concat(u32le(1), bad));
    expect(() => parseBackup(buildMinimalBackup([messages]))).toThrow(/thread padding/);
  });
});
