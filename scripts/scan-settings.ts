#!/usr/bin/env tsx
/**
 * Verify the structural SETTINGS parser against the real backup.
 *
 * Section 1 checks the framing invariant that makes the whole approach
 * legitimate: the nested TLV walk has to consume the section byte-exactly.
 * Section 2 compares what each bucket header declares against what was
 * actually decoded. Section 3 breaks the messages down by direction and
 * transport — the axis the old anchor scan collapsed. Section 4 shows the
 * media deliveries and how many THREAD records they resolve.
 *
 * Usage:
 *   pnpm tsx scripts/scan-settings.ts ./PlusMessage.backup
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseBackup, parseSettings, readTlv, BinaryReader, TLV_HEADER_SIZE } from '../src/parser';
import type { SettingsPeer } from '../src/parser';

function pct(n: number, total: number): string {
  return total === 0 ? '—' : `${((n / total) * 100).toFixed(1)}%`;
}

function main(): void {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error('usage: pnpm tsx scripts/scan-settings.ts <path-to-backup>');
    process.exit(2);
  }
  const buffer = new Uint8Array(readFileSync(resolve(inputPath)));
  const backup = parseBackup(buffer);
  if (!backup.settings) {
    console.error('no SETTINGS section found');
    process.exit(1);
  }

  const settingsBytes = backup.settings.bytes;
  const record = readTlv(new BinaryReader(settingsBytes, 0, settingsBytes.length));
  const peers: SettingsPeer[] = parseSettings({ ...record, offset: backup.settings.offset });

  console.log('=== 1. framing ===');
  const content = settingsBytes.subarray(TLV_HEADER_SIZE);
  const view = new DataView(content.buffer, content.byteOffset, content.byteLength);
  let cursor = 4;
  let buckets = 0;
  while (cursor + TLV_HEADER_SIZE <= content.length) {
    const len = view.getUint32(cursor + 6, true);
    if (len > content.length - cursor - TLV_HEADER_SIZE) break;
    cursor += TLV_HEADER_SIZE + len;
    buckets += 1;
  }
  console.log(`section content   : ${content.length} B`);
  console.log(`declared peers    : ${view.getUint32(0, true)}`);
  console.log(`buckets walked    : ${buckets}`);
  console.log(
    `bytes consumed    : ${cursor} ${cursor === content.length ? '(exact)' : '(MISMATCH)'}`,
  );

  console.log('\n=== 2. per-peer decode vs bucket header ===');
  console.log('  declared   decoded');
  console.log('  rec  med   txt  med  oth  peer');
  let mismatches = 0;
  for (const peer of peers) {
    const decoded = peer.messages.length + peer.media.length + peer.unknownRecords;
    const flag = decoded === peer.declared.records ? ' ' : '!';
    if (flag === '!') mismatches += 1;
    console.log(
      `${flag} ${String(peer.declared.records).padStart(3)} ${String(peer.declared.media).padStart(4)}` +
        `   ${String(peer.messages.length).padStart(3)} ${String(peer.media.length).padStart(4)}` +
        ` ${String(peer.unknownRecords).padStart(4)}  ${peer.peerId}` +
        `${peer.displayName ? ` (${peer.displayName})` : ''}`,
    );
  }
  console.log(`\npeers: ${peers.length}, count mismatches: ${mismatches}`);

  console.log('\n=== 3. messages by direction × transport ===');
  const grid = new Map<string, number>();
  let messages = 0;
  for (const peer of peers) {
    for (const m of peer.messages) {
      messages += 1;
      const key = `${m.direction.padEnd(8)} ${m.transport}`;
      grid.set(key, (grid.get(key) ?? 0) + 1);
    }
  }
  for (const [key, n] of [...grid].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${key}  (${pct(n, messages)})`);
  }
  console.log(`  total ${messages} bodies`);

  console.log('\n=== 4. media deliveries ===');
  const deliveries = backup.mediaDeliveries;
  const byDirection = new Map<string, number>();
  const byType = new Map<string, number>();
  for (const d of deliveries) {
    byDirection.set(d.direction, (byDirection.get(d.direction) ?? 0) + 1);
    const label = `${d.contentType}${d.isSticker ? ' (sticker)' : ''}`;
    byType.set(label, (byType.get(label) ?? 0) + 1);
  }
  console.log(`deliveries       : ${deliveries.length}`);
  console.log(`by direction     : ${[...byDirection].map(([k, v]) => `${k}=${v}`).join(' ')}`);
  console.log(`by content type  : ${[...byType].map(([k, v]) => `${k}=${v}`).join(' ')}`);
  console.log(`with file size   : ${deliveries.filter((d) => d.fileSize !== undefined).length}`);
  console.log(`with expiry      : ${deliveries.filter((d) => d.expiresAt !== undefined).length}`);

  const resolved = backup.threads.filter((t) => t.peerId !== undefined).length;
  const timed = backup.threads.filter((t) => t.attachments.some((a) => a.timestamp)).length;
  console.log(`\nTHREAD records   : ${backup.threads.length}`);
  console.log(`peer resolved    : ${resolved} (${pct(resolved, backup.threads.length)})`);
  console.log(`attachment timed : ${timed} (${pct(timed, backup.threads.length)})`);

  const flagLocal = backup.threads.filter((t) => t.headerFlag === 0).length;
  const outgoing = backup.threads.filter((t) =>
    t.attachments.some((a) => a.direction === 'outgoing'),
  ).length;
  console.log(
    `\ncross-check: headerFlag=0 (device-local) ${flagLocal} vs outgoing-by-source ${outgoing}` +
      ` ${flagLocal === outgoing ? '✓ agree' : '✗ disagree'}`,
  );
}

main();
