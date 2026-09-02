import type { InboxBucket, InboxMessage, ThreadSummary } from '../parser/types';
import { normalizePeerId } from './contactResolver';

/**
 * Map of normalized peer id → ordered inbox messages (ascending by
 * timestamp). The UI looks messages up via the currently-selected thread's
 * `peerId`, which is similarly normalized.
 */
export function buildInboxIndex(
  inbox: readonly InboxBucket[] | undefined,
): Map<string, InboxMessage[]> {
  const idx = new Map<string, InboxMessage[]>();
  if (!inbox) return idx;
  for (const bucket of inbox) {
    const key = normalizePeerId(bucket.peerId ?? '');
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
 * Build the conversation list the sidebar renders.
 *
 * A THREAD record holds one media file, not a conversation, so the 44 records
 * in the real backup belong to just two peers. Listing them raw produced 43
 * sidebar rows with the same name; here they are folded into one row per
 * peer, then inbox buckets with no media of their own are appended.
 *
 * Merged rows keep the {@link ThreadSummary} shape so the sidebar and detail
 * pane don't need to know a row can span several records. Fields that only
 * describe a single record (`raw`, `bodyOffset`, `headerFlag`,
 * `headerSizeField`) are taken from the first record of the group and are
 * only ever surfaced in the debug view.
 */
export function composeThreadList(
  threads: readonly ThreadSummary[],
  inbox: readonly InboxBucket[] | undefined,
): ThreadSummary[] {
  const groups = new Map<string, ThreadSummary[]>();
  // A peer key holds the group's place in file order; a thread is one that
  // never resolved to a peer and stays on its own row.
  const order: (ThreadSummary | string)[] = [];

  for (const t of threads) {
    const key = normalizePeerId(t.peerId ?? '');
    if (!key) {
      order.push(t);
      continue;
    }
    const group = groups.get(key);
    if (group) {
      group.push(t);
    } else {
      groups.set(key, [t]);
      order.push(key);
    }
  }

  const combined = order.map((entry) =>
    typeof entry === 'string' ? mergeThreads(entry, groups.get(entry)!) : entry,
  );

  if (inbox) {
    for (const bucket of inbox) {
      const key = normalizePeerId(bucket.peerId ?? '');
      if (!key || groups.has(key)) continue;
      groups.set(key, []);
      combined.push(virtualThreadFromBucket(bucket));
    }
  }
  return combined;
}

function mergeThreads(key: string, group: readonly ThreadSummary[]): ThreadSummary {
  const first = group[0]!;
  if (group.length === 1) return { ...first, id: `peer:${key}` };
  const merged: ThreadSummary = {
    ...first,
    id: `peer:${key}`,
    messageCount: group.reduce((n, t) => n + t.messageCount, 0),
    bodyLength: group.reduce((n, t) => n + t.bodyLength, 0),
    strings: group.flatMap((t) => t.strings),
    attachments: group.flatMap((t) => t.attachments),
  };
  // The row now spans several files, so a single file's metadata would lie.
  delete merged.media;
  return merged;
}

const EMPTY_THREAD: ThreadSummary = {
  id: '',
  threadId: -1,
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

function virtualThreadFromBucket(bucket: InboxBucket): ThreadSummary {
  const textBytes = bucket.messages.reduce((sum, m) => sum + m.text.length, 0);
  return {
    ...EMPTY_THREAD,
    id: `inbox:${bucket.peerId}`,
    peerId: bucket.peerId,
    messageCount: bucket.messages.length,
    raw: { type: 0x0001, offset: bucket.offset, length: bucket.length },
    bodyOffset: bucket.offset,
    bodyLength: textBytes,
  };
}
