/**
 * Small LRU cache of Blob URLs keyed by (offset, length). The UI mounts many
 * AttachmentImage components as the user scrolls; without a cap we would leak
 * one object URL per visit. Eviction runs URL.revokeObjectURL so the browser
 * can reclaim the backing bytes.
 *
 * The cache survives component unmounts — React StrictMode remounts and quick
 * scroll-past-and-back should hit the cache rather than refetching.
 */
const MAX_ENTRIES = 64;

interface Entry {
  url: string;
  bytes: number;
}

const cache = new Map<string, Entry>();

function key(offset: number, length: number): string {
  return `${offset}:${length}`;
}

export function getCachedBlobUrl(offset: number, length: number): string | undefined {
  const k = key(offset, length);
  const entry = cache.get(k);
  if (!entry) return undefined;
  // Re-insert to mark as most-recently-used.
  cache.delete(k);
  cache.set(k, entry);
  return entry.url;
}

export function setCachedBlobUrl(offset: number, length: number, url: string): void {
  const k = key(offset, length);
  const existing = cache.get(k);
  if (existing) {
    cache.delete(k);
    if (existing.url !== url) URL.revokeObjectURL(existing.url);
  }
  cache.set(k, { url, bytes: length });
  evictIfNeeded();
}

function evictIfNeeded(): void {
  while (cache.size > MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) return;
    const entry = cache.get(oldestKey);
    cache.delete(oldestKey);
    if (entry) URL.revokeObjectURL(entry.url);
  }
}

export function clearBlobCache(): void {
  for (const entry of cache.values()) URL.revokeObjectURL(entry.url);
  cache.clear();
}
