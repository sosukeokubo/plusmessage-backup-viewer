import type { ContactSummary, ThreadSummary } from '../parser/types';

export interface ResolvedContact {
  displayName: string;
  kind: 'named' | 'phone' | 'service' | 'group' | 'unknown';
  avatarInitial: string;
}

const PHONE_LIKE = /^\+?[\d\-()\s]{8,}$/;

export function isPhoneLike(raw: string): boolean {
  return PHONE_LIKE.test(raw.trim());
}

export function normalizePhone(raw: string): string {
  return raw.replace(/\D+/g, '');
}

/**
 * Key for joining a peer across sections. Phones normalise to bare digits so
 * `090-1111-2222` and `+819011112222` land on different keys only when they
 * really are different numbers; service addresses (`operator@kw.…`) have no
 * digits to strip, so they keep their own text lowercased.
 */
export function normalizePeerId(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  return isPhoneLike(trimmed) ? normalizePhone(trimmed) : trimmed.toLowerCase();
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
    const key = normalizePeerId(c.phone);
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

/**
 * Decide what the sidebar shows for a thread.
 *
 * Name sources, in order: the CONTACTS section, then the display names
 * embedded in SETTINGS message records. On the real backup CONTACTS carries
 * no names at all, so `peerNames` is where every name actually comes from —
 * see `extractPeerNames`.
 */
export function resolveThreadContact(
  thread: ThreadSummary,
  index: Map<string, ContactSummary>,
  fallbackIndex: number,
  peerNames: Record<string, string> = {},
): ResolvedContact {
  if (thread.isGroup) {
    return { displayName: 'グループトーク', kind: 'group', avatarInitial: '👥' };
  }
  if (thread.peerId) {
    const key = normalizePeerId(thread.peerId);
    const name = index.get(key)?.name ?? peerNames[thread.peerId];
    if (name) {
      return { displayName: name, kind: 'named', avatarInitial: firstGrapheme(name) };
    }
    if (!isPhoneLike(thread.peerId)) {
      // Service accounts (carrier notices, the docomo official account) are
      // shown verbatim — inventing a Japanese label would put a guess on
      // screen next to text that really is in the file.
      return {
        displayName: thread.peerId,
        kind: 'service',
        avatarInitial: firstGrapheme(thread.peerId),
      };
    }
    const pretty = formatPhone(thread.peerId);
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
