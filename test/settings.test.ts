import { describe, expect, it } from 'vitest';
import { parseSettings } from '../src/parser/settings';
import { collectPeerNames, toInboxBuckets } from '../src/parser/inbox';
import type { TlvRecord } from '../src/parser/types';

const encoder = new TextEncoder();
const GS = '\x1d';
const RS = '\x1e';

function u32(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
}

function u16(n: number): Uint8Array {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, n, true);
  return b;
}

function i64(n: bigint): Uint8Array {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigInt64(0, n, true);
  return b;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/** `[u32 len][utf-8 bytes]`, the only string encoding the section uses. */
function str(s: string): Uint8Array {
  const bytes = encoder.encode(s);
  return concat(u32(bytes.length), bytes);
}

function tlv(type: number, field1: number, content: Uint8Array): Uint8Array {
  return concat(u16(type), u32(field1), u32(content.length), content);
}

/** `0 GS GS <name> GS tel GS <phone> GS … RS <peer id> RS` */
function contactBlock(peerId: string, name = ''): Uint8Array {
  return encoder.encode(
    `0${GS}${GS}${name}${GS}tel${GS}${peerId}${GS}${GS}tel:${peerId}${GS}${peerId}${GS}${GS}${GS}${GS}${RS}${peerId}${RS}`,
  );
}

interface TextOptions {
  peerId: string;
  name?: string;
  /** 7 = received, 6 = sent. */
  kind?: number;
  /** 5 = SMS, 4 = +message. */
  route?: number;
  ts?: bigint;
  text: string;
  mime?: string;
  id?: string;
  sip?: string;
}

function textRecord(o: TextOptions): Uint8Array {
  const block = contactBlock(o.peerId, o.name);
  const body = concat(
    u16(0),
    u16(3),
    u32(1),
    u32(block.length),
    block,
    u32(0), // no second contact block
    u32(o.kind ?? 7),
    u32(1),
    u32(0),
    u32(o.route ?? 5),
    u32(0),
    i64(o.ts ?? 1700000000000n),
    str(o.text),
    str(o.mime ?? 'text/plain;charset=utf-8'),
    str(o.id ?? '11111111-1111-1111-1111-111111111111'),
    str(o.sip ?? ''),
  );
  return tlv(3, body.length, body);
}

function rcsXml(name: string, contentType: string, fileSize: number): string {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<file xmlns="urn:gsma:params:xml:ns:rcs:rcs:fthttp">' +
    '<file-info type="thumbnail"><file-size>2048</file-size>' +
    '<content-type>image/png</content-type>' +
    '<data url="https://example.test/thumb" until="2024-01-11T09:26:34.516+00:00"/>' +
    '</file-info>' +
    `<file-info type="file"><file-size>${fileSize}</file-size>` +
    `<file-name>${name}</file-name><content-type>${contentType}</content-type>` +
    '<data url="https://example.test/file" until="2024-01-11T09:26:34.516+00:00"/>' +
    '</file-info></file>'
  );
}

interface MediaOptions {
  peerId: string;
  name: string;
  sourcePath: string;
  category?: string;
  contentType?: string;
  fileSize?: number;
  ts?: bigint;
  until?: bigint;
  /** Some media records repeat the contact block; both shapes must decode. */
  repeatContactBlock?: boolean;
}

function mediaRecord(o: MediaOptions): Uint8Array {
  const block = contactBlock(o.peerId);
  const contentType = o.contentType ?? 'image/png';
  const body = concat(
    u16(4),
    u16(3),
    u32(1),
    u32(block.length),
    block,
    o.repeatContactBlock ? concat(u32(block.length), block) : u32(0),
    u32(1),
    u32(8),
    u32(2),
    u32(0),
    u32(o.repeatContactBlock ? 5 : 4),
    i64(o.ts ?? 1700000000000n),
    u32(0),
    u32(4),
    i64(o.until ?? 1705000000000n),
    u32(0),
    u32(0),
    str(o.sourcePath),
    str(o.category ?? contentType),
    u32(0),
    str('image/png'), // thumbnail content type
    str('2b4d6f80-9c1e-4a35-b7d2-0e8f6a4c3b19'),
    str(rcsXml(o.name, contentType, o.fileSize ?? 202200)),
  );
  return tlv(3, body.length, body);
}

/** A 0x0003 record whose variant tag is neither text (0) nor media (4). */
function serviceRecord(peerId: string): Uint8Array {
  const block = contactBlock(peerId);
  const body = concat(u16(8), u16(4), u32(1), u32(block.length), block, u32(0), new Uint8Array(64));
  return tlv(3, body.length, body);
}

function peerBucket(peerId: string, records: Uint8Array[], declaredMedia = 0): Uint8Array {
  const id = encoder.encode(peerId);
  const header = concat(
    u32(records.length),
    u32(0),
    u32(declaredMedia),
    new Uint8Array(20),
    u32(id.length),
    id,
    new Uint8Array(8),
  );
  const content = concat(header, ...records, tlv(4, 0, new Uint8Array()));
  return tlv(2, header.length, content);
}

function settingsRecord(buckets: Uint8Array[], offset = 0x1000): TlvRecord {
  const content = concat(u32(buckets.length), ...buckets);
  return { type: 0x0001, offset, field1: 4, contentLen: content.length, content, raw: content };
}

describe('parseSettings', () => {
  it('walks the peer buckets and reads each peer id and display name', () => {
    const peers = parseSettings(
      settingsRecord([
        peerBucket('+819012340001', [
          textRecord({ peerId: '+819012340001', name: '花子', text: 'a' }),
        ]),
        peerBucket('operator@kw.ncs.spmode.ne.jp', [
          textRecord({ peerId: 'operator@kw.ncs.spmode.ne.jp', text: 'b' }),
        ]),
      ]),
    );
    expect(peers.map((p) => p.peerId)).toEqual(['+819012340001', 'operator@kw.ncs.spmode.ne.jp']);
    expect(peers[0]?.displayName).toBe('花子');
    expect(peers[1]?.displayName).toBeUndefined();
  });

  it('decodes a received SMS', () => {
    const [peer] = parseSettings(
      settingsRecord([
        peerBucket('+819012340001', [
          textRecord({
            peerId: '+819012340001',
            kind: 7,
            route: 5,
            ts: 1700000000000n,
            text: 'おはようございます',
            id: '3f2a91c7-0b4d-4e18-9a52-6c7d8e0f1a2b',
          }),
        ]),
      ]),
    );
    const m = peer?.messages[0];
    expect(m?.text).toBe('おはようございます');
    expect(m?.direction).toBe('incoming');
    expect(m?.transport).toBe('sms');
    expect(m?.id).toBe('3f2a91c7-0b4d-4e18-9a52-6c7d8e0f1a2b');
    expect(m?.timestamp.ms).toBe(1700000000000);
    expect(m?.timestamp.iso).toBe(new Date(1700000000000).toISOString());
    expect(m?.peerId).toBe('+819012340001');
  });

  it('decodes a sent +message', () => {
    const [peer] = parseSettings(
      settingsRecord([
        peerBucket('+819012340001', [
          textRecord({
            peerId: '+819012340001',
            kind: 6,
            route: 4,
            text: 'また連絡しますね',
            mime: 'text/plain',
          }),
        ]),
      ]),
    );
    expect(peer?.messages[0]?.direction).toBe('outgoing');
    expect(peer?.messages[0]?.transport).toBe('rcs');
  });

  // Regression: the anchor scan this parser replaced matched the header run
  // literally and only listed received-SMS (7/5) and sent-+message (6/4), so
  // every received +message was dropped — 45 of 111 bodies on the real file.
  it('decodes a received +message, the combination the anchor scan missed', () => {
    const [peer] = parseSettings(
      settingsRecord([
        peerBucket('+819012340001', [
          textRecord({
            peerId: '+819012340001',
            kind: 7,
            route: 4,
            text: '夏みかん届きましたよ',
            mime: 'text/plain',
          }),
        ]),
      ]),
    );
    expect(peer?.messages).toHaveLength(1);
    expect(peer?.messages[0]?.direction).toBe('incoming');
    expect(peer?.messages[0]?.transport).toBe('rcs');
    expect(peer?.messages[0]?.text).toBe('夏みかん届きましたよ');
  });

  it('keeps a non-text record but leaves its text empty', () => {
    const [peer] = parseSettings(
      settingsRecord([
        peerBucket('+819012340001', [
          textRecord({
            peerId: '+819012340001',
            text: 'BINARY',
            mime: 'application/vnd.gsma.botmessage.v1.0+json',
          }),
        ]),
      ]),
    );
    expect(peer?.messages[0]?.text).toBe('');
    expect(peer?.messages[0]?.mimeType).toBe('application/vnd.gsma.botmessage.v1.0+json');
  });

  it('decodes a media delivery from the RCS descriptor, not the thumbnail fields', () => {
    const [peer] = parseSettings(
      settingsRecord([
        peerBucket(
          '+819012340001',
          [
            mediaRecord({
              peerId: '+819012340001',
              name: '7c8d9e0f-1a2b-4c3d-8e5f-6a7b8c9d0e1f',
              sourcePath: '0,https://a-wss.kw.ncs.spmode.ne.jp/wss-core//rest/resource/x/2/y',
              category: 'image/gif|basic-sticker',
              contentType: 'image/gif',
              fileSize: 315082,
              ts: 1701000000000n,
              until: 1705000000000n,
            }),
          ],
          1,
        ),
      ]),
    );
    const d = peer?.media[0];
    expect(d?.name).toBe('7c8d9e0f-1a2b-4c3d-8e5f-6a7b8c9d0e1f');
    // The record's own mime field describes the thumbnail (image/png).
    expect(d?.contentType).toBe('image/gif');
    expect(d?.fileSize).toBe(315082);
    expect(d?.category).toBe('image/gif|basic-sticker');
    expect(d?.isSticker).toBe(true);
    expect(d?.timestamp.ms).toBe(1701000000000);
    expect(d?.expiresAt?.ms).toBe(1705000000000);
    expect(d?.peerId).toBe('+819012340001');
  });

  it('reads direction from where the file was sourced', () => {
    const [peer] = parseSettings(
      settingsRecord([
        peerBucket(
          '+819012340001',
          [
            mediaRecord({
              peerId: '+819012340001',
              name: 'received.png',
              sourcePath: '0,https://a-wss.kw.ncs.spmode.ne.jp/wss-core//rest/resource/x/2/y',
            }),
            mediaRecord({
              peerId: '+819012340001',
              name: 'IMG_0001.jpg',
              sourcePath: '0,/var/mobile/Containers/Data/Application/AAAA/IMG_0001.jpg',
              contentType: 'image/jpeg',
            }),
            mediaRecord({
              peerId: '+819012340001',
              name: 'IMG_0002.jpg',
              sourcePath: '0,app://photos-kit/F0E1D2C3/L0/001/RESIZE',
              contentType: 'image/jpeg',
            }),
          ],
          3,
        ),
      ]),
    );
    expect(peer?.media.map((d) => d.direction)).toEqual(['incoming', 'outgoing', 'outgoing']);
    expect(peer?.media.map((d) => d.isSticker)).toEqual([false, false, false]);
  });

  it('decodes a media record that repeats the contact block', () => {
    const [peer] = parseSettings(
      settingsRecord([
        peerBucket(
          '+819012340001',
          [
            mediaRecord({
              peerId: '+819012340001',
              name: 'twice.png',
              sourcePath: '0,https://example.test/twice',
              repeatContactBlock: true,
            }),
          ],
          1,
        ),
      ]),
    );
    expect(peer?.media).toHaveLength(1);
    expect(peer?.media[0]?.name).toBe('twice.png');
  });

  it('counts a record whose variant is neither text nor media', () => {
    const [peer] = parseSettings(
      settingsRecord([
        peerBucket('docomoPlusMessagePoint@maap.plus-msg.com', [
          textRecord({ peerId: 'docomoPlusMessagePoint@maap.plus-msg.com', text: 'hi' }),
          serviceRecord('docomoPlusMessagePoint@maap.plus-msg.com'),
        ]),
      ]),
    );
    expect(peer?.messages).toHaveLength(1);
    expect(peer?.unknownRecords).toBe(1);
    expect(peer?.declared.records).toBe(2);
  });

  it('reports the counts the bucket header declares', () => {
    const [peer] = parseSettings(
      settingsRecord([
        peerBucket(
          '+819012340001',
          [
            textRecord({ peerId: '+819012340001', text: 'a' }),
            mediaRecord({
              peerId: '+819012340001',
              name: 'x.png',
              sourcePath: '0,https://example.test/x',
            }),
          ],
          1,
        ),
      ]),
    );
    expect(peer?.declared).toEqual({ records: 2, media: 1 });
    expect(peer?.messages.length).toBe(1);
    expect(peer?.media.length).toBe(1);
  });

  it('rebases record offsets onto absolute file positions', () => {
    const rec = settingsRecord(
      [peerBucket('+819012340001', [textRecord({ peerId: '+819012340001', text: 'a' })])],
      0x4000,
    );
    const [peer] = parseSettings(rec);
    expect(peer?.offset).toBeGreaterThan(0x4000);
    expect(peer?.messages[0]?.offset).toBeGreaterThan(peer!.offset);
  });

  it('returns [] for an empty section rather than throwing', () => {
    expect(
      parseSettings({
        type: 0x0001,
        offset: 0,
        field1: 0,
        contentLen: 0,
        content: new Uint8Array(4),
        raw: new Uint8Array(4),
      }),
    ).toEqual([]);
  });

  // A damaged tail should cost the peers it actually damaged. Routing the
  // failure up to parseBackup's catch would blank the whole section, losing
  // every conversation because the last bucket was cut short.
  it('keeps the buckets before a truncated one', () => {
    const full = settingsRecord([
      peerBucket('+819012340001', [textRecord({ peerId: '+819012340001', text: 'a' })]),
      peerBucket('+819012340002', [textRecord({ peerId: '+819012340002', text: 'b' })]),
    ]);
    const cut = full.content.subarray(0, full.content.length - 40);
    const peers = parseSettings({ ...full, content: cut, contentLen: cut.length, raw: cut });
    expect(peers.map((p) => p.peerId)).toEqual(['+819012340001']);
  });
});

describe('toInboxBuckets', () => {
  it('drops peers that hold only media', () => {
    const peers = parseSettings(
      settingsRecord([
        peerBucket('+819012340001', [textRecord({ peerId: '+819012340001', text: 'a' })]),
        peerBucket(
          '+819012340002',
          [
            mediaRecord({
              peerId: '+819012340002',
              name: 'only.png',
              sourcePath: '0,https://example.test/only',
            }),
          ],
          1,
        ),
      ]),
    );
    expect(toInboxBuckets(peers).map((b) => b.peerId)).toEqual(['+819012340001']);
  });
});

describe('collectPeerNames', () => {
  it('keys the names it found by peer id and skips unnamed peers', () => {
    const peers = parseSettings(
      settingsRecord([
        peerBucket('+819012340001', [
          textRecord({ peerId: '+819012340001', name: '花子', text: 'a' }),
        ]),
        peerBucket('+819012340002', [textRecord({ peerId: '+819012340002', text: 'b' })]),
      ]),
    );
    expect(collectPeerNames(peers)).toEqual({ '+819012340001': '花子' });
  });
});
