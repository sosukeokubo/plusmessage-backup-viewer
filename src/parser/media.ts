import { BinaryReader } from './BinaryReader';
import type { MediaDelivery, MediaHeader, Thread } from './types';

/** Longest plausible file name / source path. Real values top out near 150 B. */
const MAX_FIELD = 4096;
const MIME_RE = /^[a-z]+\/[a-z0-9.+-]+$/;

/**
 * Reject control bytes but allow UTF-8 above ASCII — every name on the real
 * backup is ASCII, yet a Japanese camera-roll file name is entirely plausible
 * and the MIME check below is what actually rules out non-media bodies.
 */
function isTextField(buf: Uint8Array): boolean {
  for (const b of buf) {
    if (b < 0x20 || b === 0x7f) return false;
  }
  return true;
}

/**
 * Decode the metadata that opens a THREAD (0x0006) body.
 *
 * A 0x0006 record is not a conversation — it is a single stored media file:
 *
 *   [u32 nameLen][name][u32 pathLen][path][u32 mimeLen][mime][image bytes…]
 *
 * `name` is the +message resource UUID for downloaded content
 * (`3f2a91c7-b352-…`) or the original camera-roll file name for content the
 * user sent (`IMG_2895.jpg`). `path` is the source locator prefixed with
 * `0,` — an `https://…/wss-core/…` URL, an iOS `app://photos-kit/…` id, or a
 * `/var/mobile/…` sandbox path.
 *
 * Returns null rather than throwing: a body that doesn't open this way is a
 * shape we haven't seen, and the caller still has the raw bytes.
 */
export function readMediaHeader(body: Uint8Array): MediaHeader | null {
  const r = new BinaryReader(body, 0, body.length);
  try {
    const readField = (): Uint8Array | null => {
      const len = r.readU32LE();
      if (len < 1 || len > MAX_FIELD) return null;
      const bytes = r.readBytes(len);
      return isTextField(bytes) ? bytes : null;
    };
    const decoder = new TextDecoder('utf-8', { fatal: false });

    const nameBytes = readField();
    if (!nameBytes) return null;
    const pathBytes = readField();
    if (!pathBytes) return null;
    const mimeBytes = readField();
    if (!mimeBytes) return null;

    const contentType = decoder.decode(mimeBytes);
    if (!MIME_RE.test(contentType)) return null;

    return {
      name: decoder.decode(nameBytes),
      sourcePath: decoder.decode(pathBytes),
      contentType,
      headerLength: r.offset,
    };
  } catch {
    return null;
  }
}

/**
 * Join each THREAD record to the delivery that describes it.
 *
 * A THREAD body carries no peer information at all — no phone number, no SIP
 * URI, no contact index — but the SETTINGS record that delivered the file
 * names it in its RCS descriptor, and that record sits inside the peer's own
 * bucket. Matching {@link MediaHeader.name} against {@link MediaDelivery.name}
 * therefore resolves the owner by lookup rather than by inference; the
 * previous approach searched SETTINGS for the name and took the nearest
 * preceding peer marker, which had to give up whenever a name resolved to two
 * peers.
 *
 * The name alone is not enough for files the user sent from their own device:
 * the app appends the save time to the local copy, so the THREAD holds
 * `IMG_20230330_174646_1681607355610.jpg` where the descriptor names
 * `IMG_20230330_174646.jpg`. Those records do agree on the source path, so it
 * serves as the second key.
 *
 * A key can also be claimed twice — the same sticker sent twice produces two
 * deliveries and two THREAD records that agree on every field. Each delivery
 * is therefore handed out once, in file order: across the 36 records that
 * match unambiguously, THREAD order and delivery order agree with zero
 * inversions, so the pairing is the one the file itself implies.
 *
 * The delivery's timestamp, direction and category are copied onto the
 * attachments rather than the thread so they survive the per-peer merge in
 * `composeThreadList`, which keeps only the flattened attachment list.
 */
export function attachDeliveries(
  threads: readonly Thread[],
  deliveries: readonly MediaDelivery[],
): void {
  if (deliveries.length === 0) return;
  const byName = groupBy(deliveries, (d) => d.name);
  const bySourcePath = groupBy(deliveries, (d) => d.sourcePath);
  const claimed = new Set<MediaDelivery>();
  const unclaimed = (group: MediaDelivery[] | undefined): MediaDelivery | undefined =>
    group?.find((d) => !claimed.has(d));

  for (const thread of threads) {
    const media = thread.media;
    if (!media) continue;
    const delivery =
      unclaimed(byName.get(media.name)) ?? unclaimed(bySourcePath.get(media.sourcePath));
    if (!delivery) continue;
    claimed.add(delivery);

    thread.peerId = delivery.peerId;
    for (const attachment of thread.attachments) {
      attachment.timestamp = delivery.timestamp;
      attachment.direction = delivery.direction;
      attachment.category = delivery.category;
      attachment.isSticker = delivery.isSticker;
    }
  }
}

/** Key → every delivery carrying it, in file order. */
function groupBy(
  deliveries: readonly MediaDelivery[],
  keyOf: (d: MediaDelivery) => string,
): Map<string, MediaDelivery[]> {
  const out = new Map<string, MediaDelivery[]>();
  for (const delivery of deliveries) {
    const key = keyOf(delivery);
    if (!key) continue;
    const group = out.get(key);
    if (group) group.push(delivery);
    else out.set(key, [delivery]);
  }
  return out;
}
