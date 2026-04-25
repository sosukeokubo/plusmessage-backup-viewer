#!/usr/bin/env tsx
/**
 * Simulate what the sidebar + detail pane would see against the real backup
 * without booting Vite. Feeds the parser output through the same helpers the
 * UI uses (composeThreadList, buildInboxIndex, resolveThreadContact) and
 * prints, per composed thread, the display name the sidebar would render and
 * the inbox message count the detail pane would receive.
 *
 * Goal: prove (or disprove) the "UI wiring is broken" hunch in
 * docs/findings-2026-04-25.md — before writing any fix.
 *
 * Usage:
 *   pnpm tsx scripts/ui-probe.ts ./PlusMessage.backup
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseBackup, summarizeBackup } from '../src/parser';
import {
  buildContactIndex,
  normalizePhone,
  resolveThreadContact,
} from '../src/util/contactResolver';
import { buildInboxIndex, composeThreadList } from '../src/util/inboxIndex';

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max) + '…';
}

function main(): void {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error('usage: pnpm tsx scripts/ui-probe.ts <path-to-backup>');
    process.exit(2);
  }

  const raw = readFileSync(resolve(inputPath));
  const buf = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
  const backup = parseBackup(buf);
  const summary = summarizeBackup(backup);

  const contactIndex = buildContactIndex(summary.contacts);
  const inboxIndex = buildInboxIndex(summary.inbox);
  const composed = composeThreadList(summary.threads, summary.inbox);

  const realCount = summary.threads.length;
  const virtualCount = composed.length - realCount;
  const inboxBuckets = summary.inbox?.length ?? 0;
  const totalInboxMessages = (summary.inbox ?? []).reduce(
    (acc, b) => acc + b.messages.length,
    0,
  );

  console.log('## Pipeline counts');
  console.log(`  summary.threads:         ${realCount}`);
  console.log(`  summary.inbox buckets:   ${inboxBuckets}`);
  console.log(`  inbox messages total:    ${totalInboxMessages}`);
  console.log(`  composed threads:        ${composed.length} (real ${realCount} + virtual ${virtualCount})`);
  console.log(`  inboxIndex keys:         ${inboxIndex.size}`);
  console.log('');

  console.log('## What the sidebar would render (all composed threads)');
  let withInboxMessages = 0;
  let realWithInbox = 0;
  let virtualWithInbox = 0;
  for (let i = 0; i < composed.length; i += 1) {
    const t = composed[i]!;
    const contact = resolveThreadContact(t, contactIndex, i);
    const key = t.peerPhone ? normalizePhone(t.peerPhone) : '';
    const inbox = key ? inboxIndex.get(key) : undefined;
    const inboxCount = inbox?.length ?? 0;
    const isVirtual = t.id.startsWith('inbox:');
    if (inboxCount > 0) {
      withInboxMessages += 1;
      if (isVirtual) virtualWithInbox += 1;
      else realWithInbox += 1;
    }
    const flag = isVirtual ? 'V' : 'R';
    const phone = t.peerPhone ?? '-';
    const name = truncate(contact.displayName, 28);
    console.log(
      `  [${i.toString().padStart(3)}] ${flag}  msgs=${inboxCount.toString().padStart(3)}  name="${name.padEnd(28)}" peer=${phone}`,
    );
  }
  console.log('');

  console.log('## Summary of join outcome');
  console.log(`  composed entries with inbox messages:   ${withInboxMessages}`);
  console.log(`    ...of which are real threads:         ${realWithInbox}`);
  console.log(`    ...of which are virtual inbox rows:   ${virtualWithInbox}`);
  console.log(`  composed entries with NO inbox messages:${composed.length - withInboxMessages}`);
  console.log('');

  const unmatchedPhones = new Set(inboxIndex.keys());
  for (const t of composed) {
    if (!t.peerPhone) continue;
    unmatchedPhones.delete(normalizePhone(t.peerPhone));
  }
  if (unmatchedPhones.size > 0) {
    console.log('## Inbox phones that never reach the sidebar (BUG if > 0)');
    for (const p of unmatchedPhones) console.log(`  ${p}`);
  } else {
    console.log('## Every inbox phone is represented in the composed list.');
  }
}

main();
