import { BinaryReader } from './BinaryReader';
import { nearestPrecedingPeer, type PeerMarker } from './inbox';
import type { MediaHeader, Thread } from './types';

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
 * Attach a peer to every media record by looking its name up in SETTINGS.
 *
 * The media bytes carry no peer information at all — no phone number, no SIP
 * URI, no contact index. What ties a file to a conversation is its name: the
 * SETTINGS message that delivered it repeats the name, either inside the
 * RCS `<file-name>` descriptor or as the tail of the source path. Resolving
 * that occurrence against the nearest preceding peer marker gives the owner.
 *
 * A name that resolves to more than one peer is left unassigned rather than
 * guessed. On the real 65MB backup all 44 records resolve to exactly one
 * peer each (43 to one phone, 1 to the docomo service account).
 */
export function assignThreadPeers(
  threads: readonly Thread[],
  settingsContent: Uint8Array,
  peers: readonly PeerMarker[],
): void {
  if (peers.length === 0) return;
  const encoder = new TextEncoder();
  const cache = new Map<string, string | undefined>();

  for (const thread of threads) {
    const name = thread.media?.name;
    if (!name) continue;
    if (!cache.has(name)) {
      cache.set(name, resolveOwner(settingsContent, encoder.encode(name), peers));
    }
    const owner = cache.get(name);
    if (owner !== undefined) thread.peerId = owner;
  }
}

function resolveOwner(
  content: Uint8Array,
  needle: Uint8Array,
  peers: readonly PeerMarker[],
): string | undefined {
  let owner: string | undefined;
  for (let i = 0; i <= content.length - needle.length; i += 1) {
    if (content[i] !== needle[0]) continue;
    let matched = true;
    for (let j = 1; j < needle.length; j += 1) {
      if (content[i + j] !== needle[j]) { matched = false; break; }
    }
    if (!matched) continue;

    const peer = nearestPrecedingPeer(peers, i);
    if (peer === undefined) return undefined;
    if (owner === undefined) owner = peer;
    else if (owner !== peer) return undefined;
    i += needle.length - 1;
  }
  return owner;
}
