#!/usr/bin/env tsx
/**
 * Dump a human-readable snapshot of what the current parser sees in a real
 * PlusMessage.backup. Purpose: answer docs/open-questions.md Q1 — "how many
 * messages does the parser actually recover from the real file?" — and give
 * us the ground truth needed to decide the next restoration step.
 *
 * Usage:
 *   pnpm tsx scripts/analyze.ts ./PlusMessage.backup
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseBackup, TLV_HEADER_SIZE, SECTION_SETTINGS } from '../src/parser';

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
  console.log(
    `fileSize:     ${buf.byteLength} bytes (${(buf.byteLength / 1024 / 1024).toFixed(2)} MiB)`,
  );
  console.log('');

  const t0 = Date.now();
  const backup = parseBackup(buf);
  const parseMs = Date.now() - t0;

  console.log(`## Parser output`);
  console.log(`parserVersion:   ${backup.parserVersion}`);
  console.log(
    `bytesConsumed:   ${backup.bytesConsumed} / ${backup.fileSize} ${backup.bytesConsumed === backup.fileSize ? 'OK' : 'SHORT'}`,
  );
  console.log(`parse time:      ${parseMs} ms`);
  console.log(
    `sections:        ${backup.sections.length} (unknown: ${backup.unknownSections.length})`,
  );
  console.log('');

  console.log(`## TLV sections`);
  for (const sec of backup.sections) {
    const name = SECTION_NAMES[sec.type] ?? '?';
    console.log(
      `  ${hex4(sec.type).padEnd(6)}  ${name.padEnd(18)}  offset=0x${sec.offset.toString(16).padStart(8, '0')}  length=${sec.bytes.length}`,
    );
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
    console.log(
      `  section offset=0x${s.offset.toString(16)} length=${s.bytes.length} (content=${s.bytes.length - TLV_HEADER_SIZE})`,
    );
    if (s.type !== SECTION_SETTINGS) {
      console.log(`  WARN: section type=${hex4(s.type)} does not match SECTION_SETTINGS`);
    }
    const content = s.bytes.subarray(TLV_HEADER_SIZE);

    // The section is a counted container of peer buckets; walking it is the
    // observation. See scripts/scan-settings.ts for the full breakdown.
    const view = new DataView(content.buffer, content.byteOffset, content.byteLength);
    let cursor = 4;
    let buckets = 0;
    while (cursor + TLV_HEADER_SIZE <= content.length) {
      const len = view.getUint32(cursor + 6, true);
      if (len > content.length - cursor - TLV_HEADER_SIZE) break;
      cursor += TLV_HEADER_SIZE + len;
      buckets += 1;
    }
    console.log(`  declared peer count:     ${view.getUint32(0, true)}`);
    console.log(`  peer buckets walked:     ${buckets}`);
    console.log(
      `  bytes consumed:          ${cursor}/${content.length}` +
        `${cursor === content.length ? ' (exact)' : ' (MISMATCH)'}`,
    );
  }
  console.log('');

  console.log(`## recovered messages`);
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
      const peer = b.peerId || '(no peer)';
      const firstIso = first?.timestamp.iso ?? '';
      const firstText = first ? truncate(first.text.replace(/\n/g, '⏎'), 40) : '';
      const mime = first?.mimeType ?? '';
      const inCount = b.messages.filter((m) => m.direction === 'incoming').length;
      const outCount = b.messages.filter((m) => m.direction === 'outgoing').length;
      const dirLabel = `in=${inCount.toString().padStart(2)} out=${outCount.toString().padStart(2)}`;
      console.log(
        `    [${i}] peer=${peer.padEnd(44)} msgs=${b.messages.length.toString().padStart(3)} ${dirLabel} first=${firstIso.slice(0, 19)}  mime=${mime}`,
      );
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
      `  [${i.toString().padStart(3)}] threadId=${t.threadId.toString().padStart(3)}  flag=0x${t.headerFlag.toString(16).padStart(2, '0')}  body=${t.body.length.toString().padStart(7)}B  strings=${t.strings.length.toString().padStart(3)}  attachments=${t.attachments.length.toString().padStart(2)}  peer=${t.peerId ?? '-'}`,
    );
  }
  console.log('');
}

main();
