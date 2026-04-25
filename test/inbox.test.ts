import { describe, expect, it } from 'vitest';
import { parseInbox } from '../src/parser/inbox';
import type { TlvRecord } from '../src/parser/types';

const encoder = new TextEncoder();

function u32LE(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
}

function u64LE(n: bigint): Uint8Array {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, n, true);
  return b;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

const ANCHOR_INCOMING = new Uint8Array([
  0x07, 0x00, 0x00, 0x00,
  0x01, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00,
  0x05, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00,
]);
const ANCHOR_OUTGOING = new Uint8Array([
  0x06, 0x00, 0x00, 0x00,
  0x01, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00,
  0x04, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00,
]);

function lengthPrefixed(s: string): Uint8Array {
  const bytes = encoder.encode(s);
  return concat(u32LE(bytes.length), bytes);
}

function buildMessage(params: {
  tsMs: bigint;
  text: string;
  mime: string;
  uuid: string;
  sip: string;
  direction?: 'incoming' | 'outgoing';
}): Uint8Array {
  const anchor = params.direction === 'outgoing' ? ANCHOR_OUTGOING : ANCHOR_INCOMING;
  return concat(
    anchor,
    u64LE(params.tsMs),
    lengthPrefixed(params.text),
    lengthPrefixed(params.mime),
    lengthPrefixed(params.uuid),
    lengthPrefixed(params.sip),
  );
}

function buildBucket(peerPhone: string, messages: Uint8Array[]): Uint8Array {
  return concat(
    // A small lead-in that isn't the anchor. Our parser looks for the first
    // length-prefixed '+'-phone; everything before that is effectively
    // ignored.
    new Uint8Array([0x39, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]),
    lengthPrefixed(peerPhone),
    ...messages,
  );
}

function wrapBucketTlv(bucket: Uint8Array): Uint8Array {
  // TLV header: u16 type + u32 field1 + u32 contentLen
  const header = new Uint8Array(10);
  const dv = new DataView(header.buffer);
  dv.setUint16(0, 0x0002, true);
  dv.setUint32(2, 4, true);
  dv.setUint32(6, bucket.length, true);
  return concat(header, bucket);
}

function buildInboxRecord(buckets: Uint8Array[]): TlvRecord {
  // Real backup layout: bucket TLVs laid out back-to-back inside the
  // SETTINGS content, with no count prefix.
  const content = concat(...buckets.map(wrapBucketTlv));
  return {
    type: 0x0001,
    offset: 0x1000,
    field1: 4,
    contentLen: content.length,
    content,
    raw: content,
  };
}

describe('parseInbox', () => {
  it('recovers messages from a single bucket', () => {
    const ts = 1754000000000n; // 2025-07-31 UTC
    const msg = buildMessage({
      tsMs: ts,
      text: 'おはようございます',
      mime: 'text/plain;charset=utf-8',
      uuid: '11111111-2222-3333-4444-555555555555',
      sip: '|uuid|2025-07-31T00:00:00|<sip:anonymous@anonymous.invalid>|<sip:anonymous@anonymous.invalid>|1|1|0||',
    });
    const bucket = buildBucket('+818012345678', [msg]);
    const rec = buildInboxRecord([bucket]);

    const buckets = parseInbox(rec);
    expect(buckets).toHaveLength(1);
    expect(buckets[0]?.peerPhone).toBe('+818012345678');
    expect(buckets[0]?.messages).toHaveLength(1);
    const m = buckets[0]?.messages[0];
    expect(m?.text).toBe('おはようございます');
    expect(m?.mimeType).toBe('text/plain;charset=utf-8');
    expect(m?.id).toBe('11111111-2222-3333-4444-555555555555');
    expect(m?.timestamp.ms).toBe(Number(ts));
    expect(m?.timestamp.iso).toBe(new Date(Number(ts)).toISOString());
    expect(m?.direction).toBe('incoming');
    expect(m?.peerPhone).toBe('+818012345678');
  });

  it('parses multiple messages inside one bucket', () => {
    const m1 = buildMessage({
      tsMs: 1754000000000n,
      text: '一つ目',
      mime: 'text/plain;charset=utf-8',
      uuid: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      sip: '|ignored|',
    });
    const m2 = buildMessage({
      tsMs: 1754000060000n,
      text: '二つ目',
      mime: 'text/plain;charset=utf-8',
      uuid: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      sip: '|ignored|',
    });
    const bucket = buildBucket('+819000000000', [m1, m2]);
    const rec = buildInboxRecord([bucket]);

    const [parsed] = parseInbox(rec);
    expect(parsed?.messages.map((m) => m.text)).toEqual(['一つ目', '二つ目']);
  });

  it('parses multiple peer buckets', () => {
    const mkBucket = (phone: string, text: string, uuid: string) =>
      buildBucket(phone, [
        buildMessage({
          tsMs: 1754000000000n,
          text,
          mime: 'text/plain;charset=utf-8',
          uuid,
          sip: '|x|',
        }),
      ]);
    const rec = buildInboxRecord([
      mkBucket('+818011111111', 'hello', '11111111-1111-1111-1111-111111111111'),
      mkBucket('+818022222222', 'world', '22222222-2222-2222-2222-222222222222'),
    ]);

    const buckets = parseInbox(rec);
    expect(buckets.map((b) => b.peerPhone)).toEqual([
      '+818011111111',
      '+818022222222',
    ]);
    expect(buckets[0]?.messages[0]?.text).toBe('hello');
    expect(buckets[1]?.messages[0]?.text).toBe('world');
  });

  it('drops non-text MIME bodies from the text field but keeps the record', () => {
    const msg = buildMessage({
      tsMs: 1754000000000n,
      text: 'BINARY',
      mime: 'application/octet-stream',
      uuid: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      sip: '|x|',
    });
    const bucket = buildBucket('+818033333333', [msg]);
    const rec = buildInboxRecord([bucket]);

    const [parsed] = parseInbox(rec);
    const m = parsed?.messages[0];
    expect(m?.text).toBe('');
    expect(m?.mimeType).toBe('application/octet-stream');
  });

  it('parses bucket TLVs laid out back-to-back without a count prefix', () => {
    // Real backup layout: content starts directly with bucket TLV, no u32
    // count prefix. Autodetect should handle this.
    const msg = buildMessage({
      tsMs: 1754000000000n,
      text: 'プレフィックスなし',
      mime: 'text/plain;charset=utf-8',
      uuid: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
      sip: '|x|',
    });
    const bucket = buildBucket('+818044444444', [msg]);
    const content = wrapBucketTlv(bucket);
    const rec: TlvRecord = {
      type: 0x0001,
      offset: 0x2000,
      field1: 4,
      contentLen: content.length,
      content,
      raw: content,
    };

    const buckets = parseInbox(rec);
    expect(buckets).toHaveLength(1);
    expect(buckets[0]?.messages[0]?.text).toBe('プレフィックスなし');
  });

  it('tags outgoing-anchor records with direction=outgoing', () => {
    // Real backup observation (docs/findings-2026-04-26.md): sent +messages
    // use anchor 06…04 and mime "text/plain" instead of "text/plain;charset=utf-8".
    const sent = buildMessage({
      tsMs: 1741000000000n,
      text: 'すてきな1年になりますように',
      mime: 'text/plain',
      uuid: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
      sip: '|sent|',
      direction: 'outgoing',
    });
    const bucket = buildBucket('+819012340001', [sent]);
    const rec = buildInboxRecord([bucket]);

    const [parsed] = parseInbox(rec);
    expect(parsed?.messages).toHaveLength(1);
    expect(parsed?.messages[0]?.direction).toBe('outgoing');
    expect(parsed?.messages[0]?.text).toBe('すてきな1年になりますように');
    expect(parsed?.messages[0]?.mimeType).toBe('text/plain');
  });

  it('parses mixed incoming and outgoing records in one bucket, ordered by offset', () => {
    const incoming = buildMessage({
      tsMs: 1700000000000n,
      text: 'received',
      mime: 'text/plain;charset=utf-8',
      uuid: '11111111-1111-1111-1111-111111111111',
      sip: '|in|',
      direction: 'incoming',
    });
    const outgoing = buildMessage({
      tsMs: 1700000060000n,
      text: 'sent',
      mime: 'text/plain',
      uuid: '22222222-2222-2222-2222-222222222222',
      sip: '|out|',
      direction: 'outgoing',
    });
    const bucket = buildBucket('+818099999999', [incoming, outgoing]);
    const rec = buildInboxRecord([bucket]);

    const [parsed] = parseInbox(rec);
    expect(parsed?.messages.map((m) => [m.text, m.direction])).toEqual([
      ['received', 'incoming'],
      ['sent', 'outgoing'],
    ]);
  });

  it('returns [] for records without a bucket count', () => {
    const rec: TlvRecord = {
      type: 0x0001,
      offset: 0,
      field1: 0,
      contentLen: 0,
      content: new Uint8Array(),
      raw: new Uint8Array(),
    };
    expect(parseInbox(rec)).toEqual([]);
  });
});
