import type { ContactSummary, ThreadSummary } from '../parser/types';

export interface ResolvedContact {
  displayName: string;
  kind: 'named' | 'phone' | 'group' | 'unknown';
  avatarInitial: string;
}

export function normalizePhone(raw: string): string {
  return raw.replace(/\D+/g, '');
}

export function formatPhone(raw: string): string {
  const d = normalizePhone(raw);
  if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `${d.slice(0, 2)}-${d.slice(2, 6)}-${d.slice(6)}`;
  return raw;
}

export function buildContactIndex(
  contacts: readonly ContactSummary[],
): Map<string, ContactSummary> {
  const idx = new Map<string, ContactSummary>();
  for (const c of contacts) {
    if (!c.phone) continue;
    const key = normalizePhone(c.phone);
    if (key.length > 0 && !idx.has(key)) idx.set(key, c);
  }
  return idx;
}

function firstGrapheme(s: string): string {
  const trimmed = s.trim();
  if (!trimmed) return '?';
  const Segmenter = (Intl as unknown as { Segmenter?: typeof Intl.Segmenter }).Segmenter;
  if (Segmenter) {
    const seg = new Segmenter(undefined, { granularity: 'grapheme' });
    const iter = seg.segment(trimmed)[Symbol.iterator]();
    const first = iter.next();
    if (!first.done) return first.value.segment;
  }
  return Array.from(trimmed)[0] ?? '?';
}

export function resolveThreadContact(
  thread: ThreadSummary,
  index: Map<string, ContactSummary>,
  fallbackIndex: number,
): ResolvedContact {
  if (thread.isGroup) {
    return { displayName: 'グループトーク', kind: 'group', avatarInitial: '👥' };
  }
  if (thread.peerPhone) {
    const key = normalizePhone(thread.peerPhone);
    const contact = index.get(key);
    if (contact?.name) {
      return {
        displayName: contact.name,
        kind: 'named',
        avatarInitial: firstGrapheme(contact.name),
      };
    }
    const pretty = formatPhone(thread.peerPhone);
    return {
      displayName: pretty,
      kind: 'phone',
      avatarInitial: key.slice(-1) || '?',
    };
  }
  return {
    displayName: `会話 ${fallbackIndex + 1}`,
    kind: 'unknown',
    avatarInitial: '?',
  };
}
