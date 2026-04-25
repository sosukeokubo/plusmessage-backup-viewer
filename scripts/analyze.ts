#!/usr/bin/env tsx
/**
 * Dump a human-readable snapshot of what the current parser sees in a real
 * PlusMessage.backup. Purpose: answer docs/open-questions.md Q1 — "how many
 * inbox messages does parseInbox actually return on the real file?" — and
 * give us the ground truth needed to decide the next restoration step.
 *
 * Usage:
 *   pnpm tsx scripts/analyze.ts ./PlusMessage.backup
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  parseBackup,
  TLV_HEADER_SIZE,
  SECTION_SETTINGS,
} from '../src/parser';
import {
  ANCHOR_INCOMING,
  ANCHOR_OUTGOING,
  findAllAnchors,
  findAllPeerPhones,
} from '../src/parser/inbox';

const SECTION_NAMES: Record<number, string> = {
  0x0001: 'SETTINGS (inbox)',
  0x0005: 'MESSAGES',
  0x0006: 'THREAD',
  0x0008: 'END',
  0x000b: 'META',
  0x000d: 'CONTACTS',
};

function hex4(n: number): string {
  return '0x' + n.toString(16).padStart(4, '0');
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + '…';
}

function main(): void {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error('usage: pnpm tsx scripts/analyze.ts <path-to-backup>');
    process.exit(2);
  }

  const abs = resolve(inputPath);
  const raw = readFileSync(abs);
  const buf = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);

  console.log(`## File`);
  console.log(`path:         ${abs}`);
  console.log(`fileSize:     ${buf.byteLength} bytes (${(buf.byteLength / 1024 / 1024).toFixed(2)} MiB)`);
  console.log(`anchor IN:    ${Array.from(ANCHOR_INCOMING).map((b) => b.toString(16).padStart(2, '0')).join(' ')}`);
  console.log(`anchor OUT:   ${Array.from(ANCHOR_OUTGOING).map((b) => b.toString(16).padStart(2, '0')).join(' ')}`);
  console.log('');

  const t0 = Date.now();
  const backup = parseBackup(buf);
  const parseMs = Date.now() - t0;

  console.log(`## Parser output`);
  console.log(`parserVersion:   ${backup.parserVersion}`);
  console.log(`bytesConsumed:   ${backup.bytesConsumed} / ${backup.fileSize} ${backup.bytesConsumed === backup.fileSize ? 'OK' : 'SHORT'}`);
  console.log(`parse time:      ${parseMs} ms`);
  console.log(`sections:        ${backup.sections.length} (unknown: ${backup.unknownSections.length})`);
  console.log('');

  console.log(`## TLV sections`);
  for (const sec of backup.sections) {
    const name = SECTION_NAMES[sec.type] ?? '?';
    console.log(`  ${hex4(sec.type).padEnd(6)}  ${name.padEnd(18)}  offset=0x${sec.offset.toString(16).padStart(8, '0')}  length=${sec.bytes.length}`);
  }
  console.log('');

  console.log(`## META`);
  if (!backup.meta) {
    console.log('  (no META section)');
  } else {
    for (const kv of backup.meta.items) {
      console.log(`  ${kv.key.padEnd(24)} = ${truncate(kv.valueUtf8, 64)}`);
    }
  }
  console.log('');

  console.log(`## CONTACTS (${backup.contacts.length})`);
  for (let i = 0; i < Math.min(backup.contacts.length, 10); i += 1) {
    const c = backup.contacts[i]!;
    console.log(`  [${i}] phone=${c.phone.padEnd(16)} name=${c.name ?? ''}`);
  }
  if (backup.contacts.length > 10) {
    console.log(`  ... (${backup.contacts.length - 10} more)`);
  }
  console.log('');

  console.log(`## SETTINGS (raw observation)`);
  if (!backup.settings) {
    console.log('  (no SETTINGS section)');
  } else {
    const s = backup.settings;
    console.log(`  section offset=0x${s.offset.toString(16)} length=${s.bytes.length} (content=${s.bytes.length - TLV_HEADER_SIZE})`);
    if (s.type !== SECTION_SETTINGS) {
      console.log(`  WARN: section type=${hex4(s.type)} does not match SECTION_SETTINGS`);
    }
    const content = s.bytes.subarray(TLV_HEADER_SIZE);

    const anchors = findAllAnchors(content);
    const incomingCount = anchors.filter((a) => a.direction === 'incoming').length;
    const outgoingCount = anchors.filter((a) => a.direction === 'outgoing').length;
    console.log(`  anchor hits total:       ${anchors.length}  (in=${incomingCount}, out=${outgoingCount})`);
    if (anchors.length > 0) {
      const sample = anchors.slice(0, 5)
        .map((a) => `${a.direction === 'incoming' ? 'IN ' : 'OUT'} 0x${a.offset.toString(16)}`)
        .join(', ');
      console.log(`  first 5 anchor offsets:  ${sample}`);
    }

    const phones = findAllPeerPhones(content);
    const phoneCounts = new Map<string, number>();
    for (const p of phones) {
      phoneCounts.set(p.phone, (phoneCounts.get(p.phone) ?? 0) + 1);
    }
    const uniquePhones = [...phoneCounts.entries()].sort((a, b) => b[1] - a[1]);
    console.log(`  phone markers (total):   ${phones.length}`);
    console.log(`  phone markers (unique):  ${uniquePhones.length}`);
    console.log(`  top 10 phones by count:`);
    for (const [phone, count] of uniquePhones.slice(0, 10)) {
      console.log(`    ${count.toString().padStart(3)} × ${phone}`);
    }
  }
  console.log('');

  console.log(`## parseInbox result`);
  const inbox = backup.inbox ?? [];
  const totalMessages = inbox.reduce((acc, b) => acc + b.messages.length, 0);
  const incomingTotal = inbox.reduce(
    (acc, b) => acc + b.messages.filter((m) => m.direction === 'incoming').length,
    0,
  );
  const outgoingTotal = inbox.reduce(
    (acc, b) => acc + b.messages.filter((m) => m.direction === 'outgoing').length,
    0,
  );
  console.log(`  buckets:        ${inbox.length}`);
  console.log(`  messages total: ${totalMessages}  (in=${incomingTotal}, out=${outgoingTotal})`);
  if (inbox.length > 0) {
    const sorted = [...inbox].sort((a, b) => b.messages.length - a.messages.length);
    console.log(`  buckets (sorted by messages desc):`);
    for (let i = 0; i < sorted.length; i += 1) {
      const b = sorted[i]!;
      const first = b.messages[0];
      const phone = b.peerPhone || '(no phone)';
      const firstIso = first?.timestamp.iso ?? '';
      const firstText = first ? truncate(first.text.replace(/\n/g, '⏎'), 40) : '';
      const mime = first?.mimeType ?? '';
      const inCount = b.messages.filter((m) => m.direction === 'incoming').length;
      const outCount = b.messages.filter((m) => m.direction === 'outgoing').length;
      const dirLabel = `in=${inCount.toString().padStart(2)} out=${outCount.toString().padStart(2)}`;
      console.log(`    [${i}] phone=${phone.padEnd(16)} msgs=${b.messages.length.toString().padStart(3)} ${dirLabel} first=${firstIso.slice(0, 19)}  mime=${mime}`);
      if (firstText) {
        console.log(`         text: ${firstText}`);
      }
    }
  }
  console.log('');

  console.log(`## MESSAGES / THREADS (${backup.threads.length})`);
  for (let i = 0; i < backup.threads.length; i += 1) {
    const t = backup.threads[i]!;
    console.log(
      `  [${i.toString().padStart(3)}] threadId=${t.threadId.toString().padStart(3)}  flag=0x${t.headerFlag.toString(16).padStart(2, '0')}  body=${t.body.length.toString().padStart(7)}B  strings=${t.strings.length.toString().padStart(3)}  attachments=${t.attachments.length.toString().padStart(2)}  peer=${t.peerPhone ?? '-'}`,
    );
  }
  console.log('');
}

main();
