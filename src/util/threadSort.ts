import type { InboxMessage, ThreadSummary } from '../parser/types';
import { normalizePeerId } from './contactResolver';

export type ThreadSort = 'recent' | 'oldest' | 'file-order' | 'message-volume' | 'attachment-count';

export const SORT_LABELS: Record<ThreadSort, string> = {
  recent: '新しい順',
  oldest: '古い順',
  'file-order': '元の順序',
  'message-volume': 'やり取りが多い順',
  'attachment-count': '写真が多い順',
};

export const SORT_OPTIONS: ThreadSort[] = [
  'recent',
  'oldest',
  'file-order',
  'message-volume',
  'attachment-count',
];

/**
 * Last time anything happened in each row, keyed by thread id.
 *
 * A row's own {@link ThreadSummary} carries no timestamp: message times live
 * in the inbox index (keyed by normalized peer id) and media times on the
 * attachments. Both are folded together here because the detail pane shows
 * them on one timeline — a conversation whose most recent entry is a photo
 * is as recent as one that ends with text.
 *
 * Rows with nothing dated are left out of the map rather than given a
 * sentinel, so the sort can put them where they belong instead of at one
 * extreme of the timeline.
 */
export function buildLatestActivity(
  threads: readonly ThreadSummary[],
  inboxIndex: ReadonlyMap<string, InboxMessage[]>,
): Map<string, number> {
  const latest = new Map<string, number>();
  for (const thread of threads) {
    let ms = Number.NEGATIVE_INFINITY;
    const key = normalizePeerId(thread.peerId ?? '');
    for (const message of (key ? inboxIndex.get(key) : undefined) ?? []) {
      if (message.timestamp.ms > ms) ms = message.timestamp.ms;
    }
    for (const attachment of thread.attachments) {
      if (attachment.timestamp && attachment.timestamp.ms > ms) ms = attachment.timestamp.ms;
    }
    if (ms > Number.NEGATIVE_INFINITY) latest.set(thread.id, ms);
  }
  return latest;
}

export function sortThreads(
  threads: ThreadSummary[],
  sort: ThreadSort,
  latestActivity: ReadonlyMap<string, number>,
): ThreadSummary[] {
  if (sort === 'file-order') return threads;
  const copy = [...threads];
  if (sort === 'recent' || sort === 'oldest') {
    const direction = sort === 'recent' ? -1 : 1;
    copy.sort((a, b) => {
      const av = latestActivity.get(a.id);
      const bv = latestActivity.get(b.id);
      // An undated row carries no ordering information, so it sinks to the
      // bottom either way rather than claiming one end of the timeline.
      if (av === undefined) return bv === undefined ? 0 : 1;
      if (bv === undefined) return -1;
      return (av - bv) * direction;
    });
  } else if (sort === 'message-volume') {
    copy.sort((a, b) => b.bodyLength - a.bodyLength);
  } else if (sort === 'attachment-count') {
    copy.sort((a, b) => b.attachments.length - a.attachments.length);
  }
  return copy;
}
