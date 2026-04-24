import type { InboxBucket, InboxMessage, ThreadSummary } from '../parser/types';
import { normalizePhone } from './contactResolver';

/**
 * Map of normalized peer phone → ordered inbox messages (ascending by
 * timestamp). The UI looks messages up via the currently-selected thread's
 * `peerPhone`, which is similarly normalized.
 */
export function buildInboxIndex(
  inbox: readonly InboxBucket[] | undefined,
): Map<string, InboxMessage[]> {
  const idx = new Map<string, InboxMessage[]>();
  if (!inbox) return idx;
  for (const bucket of inbox) {
    const key = normalizePhone(bucket.peerPhone ?? '');
    if (!key) continue;
    const sorted = [...bucket.messages].sort((a, b) => a.timestamp.ms - b.timestamp.ms);
    const existing = idx.get(key);
    if (existing) {
      existing.push(...sorted);
      existing.sort((a, b) => a.timestamp.ms - b.timestamp.ms);
    } else {
      idx.set(key, sorted);
    }
  }
  return idx;
}

/**
 * Return a composite thread list: the real threads followed by virtual
 * entries for inbox buckets whose peerPhone never shows up in threads. The
 * virtual entries reuse the {@link ThreadSummary} shape so the existing
 * sidebar/detail components don't need to distinguish them.
 */
export function composeThreadList(
  threads: readonly ThreadSummary[],
  inbox: readonly InboxBucket[] | undefined,
): ThreadSummary[] {
  const combined: ThreadSummary[] = [...threads];
  if (!inbox || inbox.length === 0) return combined;

  const known = new Set<string>();
  for (const t of threads) {
    const key = normalizePhone(t.peerPhone ?? '');
    if (key) known.add(key);
  }

  for (const bucket of inbox) {
    const key = normalizePhone(bucket.peerPhone ?? '');
    if (!key || known.has(key)) continue;
    known.add(key);
    combined.push(virtualThreadFromBucket(bucket));
  }
  return combined;
}

function virtualThreadFromBucket(bucket: InboxBucket): ThreadSummary {
  const textBytes = bucket.messages.reduce((sum, m) => sum + m.text.length, 0);
  return {
    id: `inbox:${bucket.peerPhone}`,
    threadId: -1,
    peerPhone: bucket.peerPhone,
    isGroup: false,
    messageCount: bucket.messages.length,
    raw: { type: 0x0001, offset: bucket.offset, length: bucket.length },
    bodyOffset: bucket.offset,
    bodyLength: textBytes,
    strings: [],
    attachments: [],
    headerFlag: 0,
    headerSizeField: 0,
  };
}
