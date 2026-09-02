import { describe, expect, it } from 'vitest';
import { assignThreadPeers, readMediaHeader } from '../src/parser/media';
import type { PeerMarker } from '../src/parser/inbox';
import type { Thread } from '../src/parser/types';

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

function makeThread(threadId: number, name: string): Thread {
  const body = mediaBody(name, `0,https://example.test/${name}`, 'image/png');
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
    attachments: [],
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

describe('assignThreadPeers', () => {
  // SETTINGS shape: each peer marker is followed by the message records that
  // mention the media it delivered.
  const settingsText =
    '\x1e+818011111111\x1e ...<file-name>alpha</file-name>... url=/alpha ' +
    '\x1eoperator@kw.ncs.spmode.ne.jp\x1e ...<file-name>beta</file-name>...';
  const settings = encoder.encode(settingsText);
  const peers: PeerMarker[] = [
    { offset: settingsText.indexOf('\x1e+81'), peerId: '+818011111111' },
    {
      offset: settingsText.indexOf('\x1eoperator@'),
      peerId: 'operator@kw.ncs.spmode.ne.jp',
    },
  ];

  it('assigns the nearest preceding peer to each media record', () => {
    const threads = [makeThread(1, 'alpha'), makeThread(2, 'beta')];
    assignThreadPeers(threads, settings, peers);
    expect(threads[0]?.peerId).toBe('+818011111111');
    expect(threads[1]?.peerId).toBe('operator@kw.ncs.spmode.ne.jp');
  });

  it('leaves a name that resolves to two peers unassigned', () => {
    const text = '\x1e+818011111111\x1e gamma \x1e+818022222222\x1e gamma';
    const ambiguous = encoder.encode(text);
    const marks: PeerMarker[] = [
      { offset: text.indexOf('\x1e+818011111111'), peerId: '+818011111111' },
      { offset: text.indexOf('\x1e+818022222222'), peerId: '+818022222222' },
    ];
    const threads = [makeThread(3, 'gamma')];
    assignThreadPeers(threads, ambiguous, marks);
    expect(threads[0]?.peerId).toBeUndefined();
  });

  it('leaves a name that never appears in SETTINGS unassigned', () => {
    const threads = [makeThread(4, 'missing')];
    assignThreadPeers(threads, settings, peers);
    expect(threads[0]?.peerId).toBeUndefined();
  });
});
