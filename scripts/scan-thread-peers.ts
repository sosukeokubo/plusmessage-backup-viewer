#!/usr/bin/env tsx
/**
 * Answer docs/open-questions.md Q4 — "which peer does each THREAD record
 * belong to?" — against the real backup.
 *
 * The question's original plan was to grep thread bodies for a phone number.
 * This script keeps that check as section 1 precisely because it finds
 * nothing: a THREAD record is one stored media file and carries no peer
 * information. Section 2 onwards shows the join that does work — media name
 * → SETTINGS occurrence → nearest preceding peer marker.
 *
 * Usage:
 *   pnpm tsx scripts/scan-thread-peers.ts ./PlusMessage.backup
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseBackup, summarizeBackup, TLV_HEADER_SIZE } from '../src/parser';
import { findAllPeerIds } from '../src/parser/inbox';
import {
  buildContactIndex,
  normalizePeerId,
  resolveThreadContact,
} from '../src/util/contactResolver';
import { buildInboxIndex, composeThreadList } from '../src/util/inboxIndex';

const ascii = new TextDecoder('latin1');

function countPhoneLikeRuns(body: Uint8Array): number {
  const text = ascii.decode(body);
  const plus = text.match(/\+\d{8,15}/g)?.length ?? 0;
  const domestic = text.match(/(?<!\d)0[789]0\d{8}(?!\d)/g)?.length ?? 0;
  const uris = text.match(/(?:sip|tel):/g)?.length ?? 0;
  return plus + domestic + uris;
}

function main(): void {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error('usage: pnpm tsx scripts/scan-thread-peers.ts <path-to-backup>');
    process.exit(2);
  }

  const raw = readFileSync(resolve(inputPath));
  const buf = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
  const backup = parseBackup(buf);
  const summary = summarizeBackup(backup);

  console.log('## 1. Phone-like bytes inside THREAD bodies');
  let threadsWithPhoneBytes = 0;
  for (const t of backup.threads) {
    if (countPhoneLikeRuns(t.body) > 0) threadsWithPhoneBytes += 1;
  }
  console.log(`  threads scanned:            ${backup.threads.length}`);
  console.log(`  threads with phone-ish text: ${threadsWithPhoneBytes}`);
  console.log('  (zero is the expected result — a THREAD record is one media file)');
  console.log('');

  console.log('## 2. Peer identity markers in SETTINGS');
  const settings = backup.settings;
  const markers = settings
    ? findAllPeerIds(settings.bytes.subarray(TLV_HEADER_SIZE))
    : [];
  const distinct = [...new Set(markers.map((m) => m.peerId))];
  console.log(`  markers: ${markers.length}, distinct ids: ${distinct.length}`);
  for (const id of distinct) console.log(`    ${id}`);
  console.log('');

  console.log('## 3. Media records and the peer they resolve to');
  const perPeer = new Map<string, number>();
  let unresolved = 0;
  for (const t of backup.threads) {
    const owner = t.peerId ?? '(unresolved)';
    if (!t.peerId) unresolved += 1;
    perPeer.set(owner, (perPeer.get(owner) ?? 0) + 1);
    console.log(
      `  [${t.threadId.toString().padStart(3)}] ${(t.media?.contentType ?? '?').padEnd(11)} ` +
        `${(t.media?.name ?? '(no header)').slice(0, 40).padEnd(40)} → ${owner}`,
    );
  }
  console.log(`\n  unresolved: ${unresolved} / ${backup.threads.length}`);
  for (const [peer, n] of [...perPeer].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${peer.padEnd(44)} ${n}`);
  }
  console.log('');

  console.log('## 4. Display names recovered from SETTINGS');
  const names = Object.entries(backup.peerNames);
  console.log(`  ${names.length} named peer(s)`);
  for (const [peer, name] of names) console.log(`    ${peer.padEnd(44)} ${name}`);
  console.log('');

  console.log('## 5. Conversation list the sidebar would render');
  const contactIndex = buildContactIndex(summary.contacts);
  const inboxIndex = buildInboxIndex(summary.inbox);
  const composed = composeThreadList(summary.threads, summary.inbox);
  console.log(`  threads=${summary.threads.length} buckets=${summary.inbox?.length ?? 0} → rows=${composed.length}`);
  composed.forEach((t, i) => {
    const contact = resolveThreadContact(t, contactIndex, i, summary.peerNames);
    const msgs = t.peerId ? (inboxIndex.get(normalizePeerId(t.peerId))?.length ?? 0) : 0;
    console.log(
      `  [${i.toString().padStart(2)}] ${contact.kind.padEnd(7)} ${contact.displayName.padEnd(42)} ` +
        `msgs=${msgs.toString().padStart(3)} photos=${t.attachments.length.toString().padStart(3)}`,
    );
  });
}

main();
