import { describe, expect, it } from 'vitest';
import { attachDeliveries, readMediaHeader } from '../src/parser/media';
import type { MediaDelivery, Thread } from '../src/parser/types';

const encoder = new TextEncoder();

function u32LE(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
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

function field(s: string): Uint8Array {
  const bytes = encoder.encode(s);
  return concat(u32LE(bytes.length), bytes);
}

function mediaBody(name: string, path: string, mime: string, payload = [0xff, 0xd8]): Uint8Array {
  return concat(field(name), field(path), field(mime), new Uint8Array(payload));
}

function makeThread(
  threadId: number,
  name: string,
  path = `0,https://example.test/${name}`,
): Thread {
  const body = mediaBody(name, path, 'image/png');
  const media = readMediaHeader(body);
  const thread: Thread = {
    id: `thread-${threadId}`,
    threadId,
    isGroup: false,
    messageCount: 0,
    messages: [],
    unknownFields: [],
    raw: { type: 0x0006, offset: 0, bytes: body },
    body,
    strings: [],
    attachments: [
      {
        kind: 'image/png',
        contentType: 'image/png',
        sourceOffset: threadId * 1000,
        length: 128,
        encoding: 'raw',
      },
    ],
    headerFlag: 0,
    headerSizeField: 0,
  };
  if (media) thread.media = media;
  return thread;
}

describe('readMediaHeader', () => {
  it('decodes name, source path and content type', () => {
    const body = mediaBody(
      '3f2a91c7-0b4d-4e18-9a52-6c7d8e0f1a2b',
      '0,https://a-wss.kw.ncs.spmode.ne.jp/wss-core//rest/resource/pmzz0307f/2/3f2a91c7',
      'image/png',
    );
    const header = readMediaHeader(body);
    expect(header?.name).toBe('3f2a91c7-0b4d-4e18-9a52-6c7d8e0f1a2b');
    expect(header?.sourcePath).toContain('a-wss.kw.ncs.spmode.ne.jp');
    expect(header?.contentType).toBe('image/png');
    expect(header?.headerLength).toBe(body.length - 2);
  });

  it('decodes camera-roll records the same way', () => {
    const header = readMediaHeader(
      mediaBody('IMG_2895.jpg', '0,app://photos-kit/F0E1D2C3/L0/001/RESIZE', 'image/jpeg'),
    );
    expect(header?.name).toBe('IMG_2895.jpg');
    expect(header?.contentType).toBe('image/jpeg');
  });

  it('accepts a non-ASCII file name', () => {
    const header = readMediaHeader(mediaBody('写真.jpg', '0,/var/mobile/写真.jpg', 'image/jpeg'));
    expect(header?.name).toBe('写真.jpg');
  });

  it('returns null when the body does not open with printable metadata', () => {
    expect(readMediaHeader(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]))).toBeNull();
  });

  it('returns null when the third field is not a MIME type', () => {
    expect(readMediaHeader(mediaBody('a-name', '0,/tmp/a', 'not a mime'))).toBeNull();
  });

  it('returns null on a truncated body', () => {
    expect(readMediaHeader(concat(u32LE(64), encoder.encode('short')))).toBeNull();
  });
});

function delivery(over: Partial<MediaDelivery> & { name: string }): MediaDelivery {
  return {
    peerId: '+819012340001',
    timestamp: { ms: 1700000000000, iso: new Date(1700000000000).toISOString() },
    direction: 'incoming',
    contentType: 'image/png',
    category: 'image/png',
    isSticker: false,
    sourcePath: `0,https://example.test/${over.name}`,
    offset: 0,
    length: 0,
    ...over,
  };
}

describe('attachDeliveries', () => {
  it('resolves the peer and stamps the attachment from the matching delivery', () => {
    const threads = [makeThread(1, 'alpha')];
    attachDeliveries(threads, [
      delivery({
        name: 'alpha',
        peerId: 'operator@kw.ncs.spmode.ne.jp',
        direction: 'outgoing',
        category: 'image/png|basic-sticker',
        isSticker: true,
      }),
    ]);
    expect(threads[0]?.peerId).toBe('operator@kw.ncs.spmode.ne.jp');
    const attachment = threads[0]?.attachments[0];
    expect(attachment?.timestamp?.ms).toBe(1700000000000);
    expect(attachment?.direction).toBe('outgoing');
    expect(attachment?.category).toBe('image/png|basic-sticker');
    expect(attachment?.isSticker).toBe(true);
  });

  // The app appends the save time to a file it stored locally, so the THREAD
  // name and the RCS descriptor name differ for everything the user sent.
  // Both still agree on the source path.
  it('falls back to the source path when the stored name gained a suffix', () => {
    const path = '0,/var/mobile/Containers/Data/Application/AAAA/IMG_20230330_174646.jpg';
    const threads = [makeThread(2, 'IMG_20230330_174646_1681607355610.jpg', path)];
    attachDeliveries(threads, [
      delivery({ name: 'IMG_20230330_174646.jpg', sourcePath: path, direction: 'outgoing' }),
    ]);
    expect(threads[0]?.peerId).toBe('+819012340001');
    expect(threads[0]?.attachments[0]?.direction).toBe('outgoing');
  });

  it('hands a repeated key out once each, in file order', () => {
    const threads = [makeThread(3, 'same'), makeThread(4, 'same')];
    attachDeliveries(threads, [
      delivery({ name: 'same', timestamp: { ms: 1000, iso: 'first' } }),
      delivery({ name: 'same', timestamp: { ms: 2000, iso: 'second' } }),
    ]);
    expect(threads.map((t) => t.attachments[0]?.timestamp?.ms)).toEqual([1000, 2000]);
  });

  it('leaves a thread untouched when nothing matches', () => {
    const threads = [makeThread(5, 'orphan')];
    attachDeliveries(threads, [delivery({ name: 'other' })]);
    expect(threads[0]?.peerId).toBeUndefined();
    expect(threads[0]?.attachments[0]?.timestamp).toBeUndefined();
  });

  it('does nothing when there are no deliveries', () => {
    const threads = [makeThread(6, 'alpha')];
    attachDeliveries(threads, []);
    expect(threads[0]?.peerId).toBeUndefined();
  });
});
