import { describe, expect, it } from 'vitest';
import { buildLatestActivity, sortThreads } from '../src/util/threadSort';
import type { InboxMessage, ThreadSummary } from '../src/parser/types';

function makeThread(partial: Partial<ThreadSummary> & { id: string }): ThreadSummary {
  return {
    threadId: 1,
    isGroup: false,
    messageCount: 0,
    raw: { type: 0, offset: 0, length: 0 },
    bodyOffset: 0,
    bodyLength: 0,
    strings: [],
    attachments: [],
    headerFlag: 0,
    headerSizeField: 0,
    ...partial,
  };
}

function makeMessage(ms: number): InboxMessage {
  return {
    id: `m${ms}`,
    peerId: '+819012340001',
    text: 'こんにちは',
    mimeType: 'text/plain',
    timestamp: { ms, iso: new Date(ms).toISOString() },
    direction: 'incoming',
    transport: 'rcs',
    sipMetadata: '',
    offset: 0,
    length: 0,
  };
}

function attachment(ms?: number) {
  const base = {
    kind: 'image/jpeg' as const,
    contentType: 'image/jpeg',
    sourceOffset: 0,
    length: 10,
    encoding: 'raw' as const,
  };
  return ms === undefined ? base : { ...base, timestamp: { ms, iso: new Date(ms).toISOString() } };
}

describe('buildLatestActivity', () => {
  it('takes the newest message time for a row', () => {
    const thread = makeThread({ id: 'a', peerId: '+819012340001' });
    const idx = new Map([['819012340001', [makeMessage(100), makeMessage(300), makeMessage(200)]]]);
    expect(buildLatestActivity([thread], idx).get('a')).toBe(300);
  });

  it('lets a media attachment win over an older message', () => {
    const thread = makeThread({
      id: 'a',
      peerId: '+819012340001',
      attachments: [attachment(500)],
    });
    const idx = new Map([['819012340001', [makeMessage(100)]]]);
    expect(buildLatestActivity([thread], idx).get('a')).toBe(500);
  });

  it('matches the peer through normalization', () => {
    const thread = makeThread({ id: 'a', peerId: '+81 90-1234-0001' });
    const idx = new Map([['819012340001', [makeMessage(42)]]]);
    expect(buildLatestActivity([thread], idx).get('a')).toBe(42);
  });

  it('omits a row with nothing dated', () => {
    const thread = makeThread({ id: 'a', attachments: [attachment()] });
    expect(buildLatestActivity([thread], new Map()).has('a')).toBe(false);
  });
});

describe('sortThreads', () => {
  const a = makeThread({ id: 'a' });
  const b = makeThread({ id: 'b' });
  const c = makeThread({ id: 'c' });
  const activity = new Map([
    ['a', 100],
    ['b', 300],
    ['c', 200],
  ]);

  it('puts the most recent row first', () => {
    const out = sortThreads([a, b, c], 'recent', activity);
    expect(out.map((t) => t.id)).toEqual(['b', 'c', 'a']);
  });

  it('reverses the same key for the oldest-first order', () => {
    const out = sortThreads([a, b, c], 'oldest', activity);
    expect(out.map((t) => t.id)).toEqual(['a', 'c', 'b']);
  });

  it('sinks undated rows to the bottom in both directions', () => {
    const undated = makeThread({ id: 'x' });
    expect(sortThreads([undated, a, b], 'recent', activity).map((t) => t.id)).toEqual([
      'b',
      'a',
      'x',
    ]);
    expect(sortThreads([undated, a, b], 'oldest', activity).map((t) => t.id)).toEqual([
      'a',
      'b',
      'x',
    ]);
  });

  it('keeps file order for equal timestamps', () => {
    const tied = new Map([
      ['a', 100],
      ['b', 100],
      ['c', 100],
    ]);
    expect(sortThreads([a, b, c], 'recent', tied).map((t) => t.id)).toEqual(['a', 'b', 'c']);
  });

  it('returns the input untouched for file order', () => {
    const input = [a, b, c];
    expect(sortThreads(input, 'file-order', activity)).toBe(input);
  });

  it('still sorts by body length and attachment count', () => {
    const big = makeThread({ id: 'big', bodyLength: 500, attachments: [attachment(1)] });
    const small = makeThread({ id: 'small', bodyLength: 10 });
    expect(sortThreads([small, big], 'message-volume', activity).map((t) => t.id)).toEqual([
      'big',
      'small',
    ]);
    expect(sortThreads([small, big], 'attachment-count', activity).map((t) => t.id)).toEqual([
      'big',
      'small',
    ]);
  });
});
