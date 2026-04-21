import { describe, expect, it } from 'vitest';
import {
  buildContactIndex,
  formatPhone,
  normalizePhone,
  resolveThreadContact,
} from '../src/util/contactResolver';
import type { ContactSummary, ThreadSummary } from '../src/parser/types';

function makeThread(partial: Partial<ThreadSummary>): ThreadSummary {
  const base: ThreadSummary = {
    id: 't',
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
  };
  return { ...base, ...partial };
}

function makeContact(partial: Partial<ContactSummary>): ContactSummary {
  return {
    raw: { type: 0, offset: 0, length: 0 },
    phone: '',
    fields: [],
    otherRecords: [],
    ...partial,
  };
}

describe('normalizePhone', () => {
  it('strips non-digit chars', () => {
    expect(normalizePhone('090-1234-5678')).toBe('09012345678');
    expect(normalizePhone('+81 90 1234 5678')).toBe('819012345678');
    expect(normalizePhone('')).toBe('');
  });
});

describe('formatPhone', () => {
  it('formats 11-digit mobile numbers', () => {
    expect(formatPhone('09012345678')).toBe('090-1234-5678');
  });
  it('formats 10-digit landlines', () => {
    expect(formatPhone('0312345678')).toBe('03-1234-5678');
  });
  it('returns original when length does not match', () => {
    expect(formatPhone('12345')).toBe('12345');
  });
});

describe('buildContactIndex', () => {
  it('indexes contacts by normalized phone', () => {
    const contacts = [
      makeContact({ phone: '090-1111-2222', name: 'Alice' }),
      makeContact({ phone: '08033334444', name: 'Bob' }),
    ];
    const idx = buildContactIndex(contacts);
    expect(idx.get('09011112222')?.name).toBe('Alice');
    expect(idx.get('08033334444')?.name).toBe('Bob');
  });
  it('skips contacts with empty phone', () => {
    const idx = buildContactIndex([makeContact({ phone: '' })]);
    expect(idx.size).toBe(0);
  });
});

describe('resolveThreadContact', () => {
  const idx = buildContactIndex([makeContact({ phone: '09011112222', name: '山田太郎' })]);

  it('marks group threads', () => {
    const r = resolveThreadContact(makeThread({ isGroup: true }), idx, 0);
    expect(r.kind).toBe('group');
    expect(r.displayName).toBe('グループトーク');
    expect(r.avatarInitial).toBe('👥');
  });

  it('resolves known contacts by name', () => {
    const r = resolveThreadContact(
      makeThread({ peerPhone: '090-1111-2222' }),
      idx,
      0,
    );
    expect(r.kind).toBe('named');
    expect(r.displayName).toBe('山田太郎');
    expect(r.avatarInitial).toBe('山');
  });

  it('formats unknown phone numbers', () => {
    const r = resolveThreadContact(
      makeThread({ peerPhone: '08099998888' }),
      idx,
      0,
    );
    expect(r.kind).toBe('phone');
    expect(r.displayName).toBe('080-9999-8888');
    expect(r.avatarInitial).toBe('8');
  });

  it('falls back to sequential label when no phone', () => {
    const r = resolveThreadContact(makeThread({}), idx, 3);
    expect(r.kind).toBe('unknown');
    expect(r.displayName).toBe('会話 4');
    expect(r.avatarInitial).toBe('?');
  });
});
