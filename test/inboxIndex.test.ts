import { describe, expect, it } from 'vitest';
import { buildInboxIndex, composeThreadList } from '../src/util/inboxIndex';
import type {
  AttachmentRef,
  InboxBucket,
  InboxMessage,
  ThreadSummary,
} from '../src/parser/types';

function makeThread(partial: Partial<ThreadSummary>): ThreadSummary {
  return {
    id: 't',
    threadId: 1,
    isGroup: false,
    messageCount: 0,
    raw: { type: 0x0006, offset: 0, length: 0 },
    bodyOffset: 0,
    bodyLength: 0,
    strings: [],
    attachments: [],
    headerFlag: 0,
    headerSizeField: 0,
    ...partial,
  };
}

function attachment(sourceOffset: number): AttachmentRef {
  return {
    kind: 'image/png',
    contentType: 'image/png',
    sourceOffset,
    length: 10,
    encoding: 'zlib',
  };
}

function makeMessage(ms: number, text: string): InboxMessage {
  return {
    id: `m-${ms}`,
    peerId: '+818011111111',
    text,
    mimeType: 'text/plain',
    timestamp: { ms, iso: new Date(ms).toISOString() },
    direction: 'incoming',
    sipMetadata: '',
    offset: 0,
    length: 0,
  };
}

function makeBucket(peerId: string, messages: InboxMessage[]): InboxBucket {
  return { peerId, messages, offset: 0, length: 0 };
}

describe('buildInboxIndex', () => {
  it('keys buckets by normalized peer id and sorts by timestamp', () => {
    const idx = buildInboxIndex([
      makeBucket('+81 90-1111-2222', [makeMessage(200, 'second'), makeMessage(100, 'first')]),
    ]);
    expect(idx.get('819011112222')?.map((m) => m.text)).toEqual(['first', 'second']);
  });

  it('keeps service-address buckets, which have no digits to normalize', () => {
    const idx = buildInboxIndex([
      makeBucket('operator@kw.ncs.spmode.ne.jp', [makeMessage(1, 'notice')]),
    ]);
    expect(idx.get('operator@kw.ncs.spmode.ne.jp')).toHaveLength(1);
  });
});

describe('composeThreadList', () => {
  it('folds media records sharing a peer into one row', () => {
    const rows = composeThreadList(
      [
        makeThread({ id: 'thread-1', threadId: 1, peerId: '+818011111111', bodyLength: 10, attachments: [attachment(1)] }),
        makeThread({ id: 'thread-2', threadId: 2, peerId: '+818011111111', bodyLength: 20, attachments: [attachment(2)] }),
        makeThread({ id: 'thread-3', threadId: 3, peerId: '+818022222222', attachments: [attachment(3)] }),
      ],
      undefined,
    );
    expect(rows.map((r) => r.id)).toEqual(['peer:818011111111', 'peer:818022222222']);
    expect(rows[0]?.attachments.map((a) => a.sourceOffset)).toEqual([1, 2]);
    expect(rows[0]?.bodyLength).toBe(30);
  });

  it('drops the single-file metadata from a row spanning several files', () => {
    const media = { name: 'a', sourcePath: '0,/a', contentType: 'image/png', headerLength: 4 };
    const [merged] = composeThreadList(
      [
        makeThread({ id: 'thread-1', peerId: '+818011111111', media }),
        makeThread({ id: 'thread-2', peerId: '+818011111111', media }),
      ],
      undefined,
    );
    expect(merged?.media).toBeUndefined();
  });

  it('keeps the file metadata when the peer has exactly one file', () => {
    const media = { name: 'a', sourcePath: '0,/a', contentType: 'image/png', headerLength: 4 };
    const [only] = composeThreadList(
      [makeThread({ id: 'thread-1', peerId: '+818011111111', media })],
      undefined,
    );
    expect(only?.media?.name).toBe('a');
  });

  it('leaves records with no peer on their own rows', () => {
    const rows = composeThreadList(
      [makeThread({ id: 'thread-1' }), makeThread({ id: 'thread-2' })],
      undefined,
    );
    expect(rows.map((r) => r.id)).toEqual(['thread-1', 'thread-2']);
  });

  it('appends inbox buckets that no media record belongs to', () => {
    const rows = composeThreadList(
      [makeThread({ id: 'thread-1', peerId: '+818011111111' })],
      [
        makeBucket('+818011111111', [makeMessage(1, 'already covered')]),
        makeBucket('+818033333333', [makeMessage(2, 'text only')]),
      ],
    );
    expect(rows.map((r) => r.id)).toEqual(['peer:818011111111', 'inbox:+818033333333']);
  });
});
