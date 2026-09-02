import type { InboxBucket, SettingsPeer } from './types';

/**
 * Project the decoded SETTINGS peers onto the shape the UI addresses.
 *
 * SETTINGS is already organised by peer on disk, so this is a reshaping of
 * `parseSettings` output rather than a parse of its own: one bucket per peer,
 * minus the peers that hold only media. Media reaches the UI through the
 * attachments it stamps, not through these buckets.
 */
export function toInboxBuckets(peers: readonly SettingsPeer[]): InboxBucket[] {
  const buckets: InboxBucket[] = [];
  for (const peer of peers) {
    if (peer.messages.length === 0) continue;
    buckets.push({
      peerId: peer.peerId,
      messages: peer.messages,
      offset: peer.offset,
      length: peer.length,
    });
  }
  return buckets;
}

/**
 * Display names keyed by peer id, for peers the app stored a name for.
 *
 * Only the contact blobs inside SETTINGS records carry names; the CONTACTS
 * section (0x000d) leaves the field empty on every entry of the real backup.
 */
export function collectPeerNames(peers: readonly SettingsPeer[]): Record<string, string> {
  const names: Record<string, string> = {};
  for (const peer of peers) {
    if (peer.displayName) names[peer.peerId] = peer.displayName;
  }
  return names;
}
