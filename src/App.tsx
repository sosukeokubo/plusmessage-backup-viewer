import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { WelcomeScreen } from './ui/WelcomeScreen';
import { ThreadList } from './ui/ThreadList';
import { ThreadDetail } from './ui/ThreadDetail';
import { DarkModeToggle } from './ui/DarkModeToggle';
import { SortControls, type ThreadSort } from './ui/SortControls';
import { HexDump } from './debug/HexDump';
import { TlvTree } from './debug/TlvTree';
import type { BackupSummary, ParseProgress, ThreadSummary } from './parser/types';
import { ParserClient } from './worker/parserClient';
import { clearBlobCache } from './util/blobCache';
import {
  buildContactIndex,
  normalizePeerId,
  resolveThreadContact,
  type ResolvedContact,
} from './util/contactResolver';
import { buildInboxIndex, composeThreadList } from './util/inboxIndex';

const STAGE_LABEL: Record<ParseProgress['stage'], string> = {
  scan: 'バックアップを確認中…',
  meta: '基本情報を読み取り中…',
  contacts: '連絡先を読み取り中…',
  threads: '会話を読み取り中…',
  summarize: 'もう少しで完了します…',
  done: '読込完了',
};

function readDebugFlag(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return new URLSearchParams(window.location.search).get('debug') === '1';
  } catch {
    return false;
  }
}

export function App() {
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [summary, setSummary] = useState<BackupSummary | null>(null);
  const [progress, setProgress] = useState<ParseProgress | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [jumpOffset, setJumpOffset] = useState<number | undefined>(undefined);
  const [showDebug, setShowDebug] = useState(false);
  const [selectedThreadId, setSelectedThreadId] = useState<string | undefined>(undefined);
  const [threadSort, setThreadSort] = useState<ThreadSort>('file-order');
  const [searchQuery, setSearchQuery] = useState('');
  const [client, setClient] = useState<ParserClient | null>(null);
  const clientRef = useRef<ParserClient | null>(null);
  const debugEnabled = useMemo(() => readDebugFlag(), []);

  useEffect(() => {
    return () => {
      clientRef.current?.terminate();
      clientRef.current = null;
      clearBlobCache();
    };
  }, []);

  const handleFile = useCallback((file: File, buffer: ArrayBuffer) => {
    const mainCopy = new Uint8Array(buffer.slice(0));
    setBytes(mainCopy);
    setFileName(file.name);
    setSummary(null);
    setParseError(null);
    setProgress({ stage: 'scan', progress: 0 });
    setSelectedThreadId(undefined);
    setJumpOffset(undefined);
    setSearchQuery('');

    clientRef.current?.terminate();
    clearBlobCache();
    const next = new ParserClient();
    clientRef.current = next;
    setClient(next);
    next
      .parse(buffer, { onProgress: setProgress })
      .then((s) => {
        setSummary(s);
      })
      .catch((err: Error) => {
        setParseError(err.message);
      });
  }, []);

  const handleReset = useCallback(() => {
    clientRef.current?.terminate();
    clientRef.current = null;
    setClient(null);
    clearBlobCache();
    setBytes(null);
    setFileName(null);
    setSummary(null);
    setParseError(null);
    setProgress(null);
    setJumpOffset(undefined);
    setSelectedThreadId(undefined);
    setSearchQuery('');
  }, []);

  const contactIndex = useMemo(() => {
    if (!summary) return new Map();
    return buildContactIndex(summary.contacts);
  }, [summary]);

  const inboxIndex = useMemo(() => buildInboxIndex(summary?.inbox), [summary]);

  const composedThreads = useMemo(() => {
    if (!summary) return [];
    return composeThreadList(summary.threads, summary.inbox);
  }, [summary]);

  // Stable index per thread based on its position in the composed list. Used
  // so fallback labels like "会話 5" stay the same regardless of current sort
  // or filter — otherwise a user searching "会話 5" would see the 5th result
  // rename itself to "会話 1".
  const threadFileIndex = useMemo(() => {
    const map = new Map<string, number>();
    composedThreads.forEach((t, i) => map.set(t.id, i));
    return map;
  }, [composedThreads]);

  const sortedThreads = useMemo(() => {
    return sortThreads(composedThreads, threadSort);
  }, [composedThreads, threadSort]);

  const resolveForThread = useCallback(
    (thread: ThreadSummary): ResolvedContact =>
      resolveThreadContact(
        thread,
        contactIndex,
        threadFileIndex.get(thread.id) ?? 0,
        summary?.peerNames,
      ),
    [contactIndex, threadFileIndex, summary],
  );

  const inboxForThread = useCallback(
    (thread: ThreadSummary) => {
      if (!thread.peerId) return undefined;
      const key = normalizePeerId(thread.peerId);
      return key ? inboxIndex.get(key) : undefined;
    },
    [inboxIndex],
  );

  const filteredThreads = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return sortedThreads;
    return sortedThreads.filter((t) => {
      const c = resolveForThread(t);
      const hay = `${c.displayName} ${t.peerId ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [sortedThreads, searchQuery, resolveForThread]);

  const selectedThread = useMemo(() => {
    return composedThreads.find((t) => t.id === selectedThreadId);
  }, [composedThreads, selectedThreadId]);

  const selectedContact = useMemo((): ResolvedContact | undefined => {
    if (!selectedThread) return undefined;
    return resolveForThread(selectedThread);
  }, [selectedThread, resolveForThread]);

  const selectedInboxMessages = useMemo(() => {
    if (!selectedThread?.peerId) return undefined;
    const key = normalizePeerId(selectedThread.peerId);
    return key ? inboxIndex.get(key) : undefined;
  }, [selectedThread, inboxIndex]);

  const parseInFlight = bytes !== null && summary === null && parseError === null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <header
        style={{
          padding: '12px 20px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg-elev)',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <strong style={{ fontSize: 16 }}>＋メッセージ バックアップビューアー</strong>
        {summary && (
          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
            会話 {composedThreads.length} 件
          </span>
        )}
        {debugEnabled && bytes && fileName && (
          <span style={{ color: 'var(--text-muted)', fontSize: 12, fontFamily: 'var(--mono)' }}>
            {fileName} ({bytes.byteLength.toLocaleString()} B)
          </span>
        )}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          {bytes && (
            <button
              onClick={handleReset}
              style={{
                padding: '6px 12px',
                borderRadius: 6,
                border: '1px solid var(--border)',
                background: 'var(--bg)',
                color: 'var(--text)',
              }}
            >
              別のファイルを開く
            </button>
          )}
          <DarkModeToggle />
        </span>
      </header>

      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 20, gap: 16 }}>
        {!bytes ? (
          <WelcomeScreen onFile={handleFile} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0, flex: 1 }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              {debugEnabled && (
                <label
                  style={{
                    fontSize: 12,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    color: 'var(--text-muted)',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={showDebug}
                    onChange={(e) => setShowDebug(e.target.checked)}
                  />
                  開発者ビュー (TLV + hex)
                </label>
              )}
              {!showDebug && summary && (
                <SortControls value={threadSort} onChange={setThreadSort} />
              )}
              {parseInFlight && (
                <ProgressIndicator progress={progress} debug={debugEnabled} />
              )}
              {parseError && (
                <span style={{ color: 'var(--danger)', fontSize: 12 }}>
                  読込失敗: {parseError}
                </span>
              )}
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: showDebug ? '1fr 1fr' : '320px 1fr',
                gap: 12,
                minHeight: 0,
                flex: 1,
              }}
            >
              {showDebug ? (
                <>
                  {summary ? (
                    <TlvTree
                      backup={summary}
                      onJumpTo={setJumpOffset}
                      highlightOffset={jumpOffset}
                    />
                  ) : (
                    <PlaceholderBox
                      message={parseError ? 'パース結果を表示できません。' : 'パース中…'}
                    />
                  )}
                  <HexDump bytes={bytes} jumpToOffset={jumpOffset} />
                </>
              ) : summary ? (
                <>
                  <ThreadList
                    totalCount={composedThreads.length}
                    selectedId={selectedThreadId}
                    onSelect={setSelectedThreadId}
                    threads={filteredThreads}
                    resolveContact={resolveForThread}
                    inboxFor={inboxForThread}
                    sort={threadSort}
                    searchQuery={searchQuery}
                    onSearchChange={setSearchQuery}
                  />
                  <ThreadDetail
                    thread={selectedThread}
                    contact={selectedContact}
                    client={client}
                    inboxMessages={selectedInboxMessages}
                    debug={debugEnabled}
                    onJumpToOffset={
                      debugEnabled
                        ? (off) => {
                            setJumpOffset(off);
                            setShowDebug(true);
                          }
                        : undefined
                    }
                  />
                </>
              ) : (
                <PlaceholderBox
                  message={
                    parseError
                      ? '読込に失敗しました。別のファイルをお試しください。'
                      : '読込中…'
                  }
                />
              )}
            </div>
          </div>
        )}
      </main>

      <footer
        style={{
          padding: '8px 20px',
          borderTop: '1px solid var(--border)',
          color: 'var(--text-muted)',
          fontSize: 12,
          display: 'flex',
          justifyContent: 'space-between',
        }}
      >
        <span>🔒 ブラウザ内のみで処理。ファイルは送信されません。</span>
        <span>v0.1.0</span>
      </footer>
    </div>
  );
}

function ProgressIndicator({
  progress,
  debug,
}: {
  progress: ParseProgress | null;
  debug: boolean;
}) {
  const value = progress?.progress ?? 0;
  const stage = progress?.stage ?? 'scan';
  const note = progress?.note;
  const label = STAGE_LABEL[stage];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        fontSize: 12,
        color: 'var(--text-muted)',
      }}
    >
      <progress value={value} max={1} style={{ width: 140 }} />
      <span>
        {label}
        {debug && note ? ` — ${note}` : ''} ({Math.round(value * 100)}%)
      </span>
    </span>
  );
}

function sortThreads(threads: ThreadSummary[], sort: ThreadSort): ThreadSummary[] {
  if (sort === 'file-order') return threads;
  const copy = [...threads];
  if (sort === 'message-volume') {
    copy.sort((a, b) => b.bodyLength - a.bodyLength);
  } else if (sort === 'attachment-count') {
    copy.sort((a, b) => b.attachments.length - a.attachments.length);
  }
  return copy;
}

function PlaceholderBox({ message }: { message: string }) {
  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: 16,
        background: 'var(--bg-elev)',
        fontSize: 13,
        color: 'var(--text-muted)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {message}
    </div>
  );
}
