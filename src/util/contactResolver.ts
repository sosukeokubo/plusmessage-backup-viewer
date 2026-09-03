import type { ContactSummary, ThreadSummary } from '../parser/types';

export interface ResolvedContact {
  displayName: string;
  kind: 'named' | 'phone' | 'service' | 'group' | 'unknown';
  avatarInitial: string;
  /** ファイル上の値。`displayName` がその整形結果であるときだけ入る。 */
  sourceId?: string;
}

const PHONE_LIKE = /^\+?[\d\-()\s]{8,}$/;

export function isPhoneLike(raw: string): boolean {
  return PHONE_LIKE.test(raw.trim());
}

export function normalizePhone(raw: string): string {
  return raw.replace(/\D+/g, '');
}

/**
 * Key for joining a peer across sections. Phones normalise to bare digits and
 * service addresses (`operator@kw.…`) have no digits to strip, so they keep
 * their own text lowercased.
 *
 * The country code is *not* normalised: `+819011112222` and `09011112222` are
 * the same number but land on different keys. Every phone in the real backup
 * is stored in `+81` form, so the split has never been observed — Q14.
 */
export function normalizePeerId(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  return isPhoneLike(trimmed) ? normalizePhone(trimmed) : trimmed.toLowerCase();
}

const JP_COUNTRY_CODE = '81';

/**
 * Format a number for display, in the domestic notation a Japanese phonebook
 * shows. `+81` numbers get their country code swapped back for the leading
 * `0` it replaced, which puts both mobiles (`+81` + 10 digits) and landlines
 * (`+81` + 9) on the length rules below.
 *
 * Other country codes are returned untouched: none appear in the real backup,
 * so how to group their digits would be a guess — and applying the Japanese
 * rules to them silently produces a wrong-looking number.
 */
export function formatPhone(raw: string): string {
  const trimmed = raw.trim();
  const digits = normalizePhone(trimmed);
  let d = digits;
  if (trimmed.startsWith('+')) {
    if (!digits.startsWith(JP_COUNTRY_CODE)) return raw;
    d = `0${digits.slice(JP_COUNTRY_CODE.length)}`;
  }
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
      // Only when the digits themselves were rewritten — a domestic number
      // that merely gained hyphens has nothing worth showing on hover.
      ...(normalizePhone(pretty) === key ? {} : { sourceId: thread.peerId }),
    };
  }
  return {
    displayName: `会話 ${fallbackIndex + 1}`,
    kind: 'unknown',
    avatarInitial: '?',
  };
}
