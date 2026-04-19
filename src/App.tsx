import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FilePicker } from './ui/FilePicker';
import { PrivacyBanner } from './ui/PrivacyBanner';
import { ThreadList } from './ui/ThreadList';
import { ThreadDetail } from './ui/ThreadDetail';
import { HexDump } from './debug/HexDump';
import { TlvTree } from './debug/TlvTree';
import type { BackupSummary, ParseProgress } from './parser/types';
import { ParserClient } from './worker/parserClient';
import { clearBlobCache } from './util/blobCache';

export function App() {
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [summary, setSummary] = useState<BackupSummary | null>(null);
  const [progress, setProgress] = useState<ParseProgress | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [jumpOffset, setJumpOffset] = useState<number | undefined>(undefined);
  const [showDebug, setShowDebug] = useState(false);
  const [selectedThreadId, setSelectedThreadId] = useState<string | undefined>(undefined);
  const [client, setClient] = useState<ParserClient | null>(null);
  const clientRef = useRef<ParserClient | null>(null);

  useEffect(() => {
    return () => {
      clientRef.current?.terminate();
      clientRef.current = null;
      clearBlobCache();
    };
  }, []);

  const handleFile = useCallback((file: File, buffer: ArrayBuffer) => {
    // Keep a main-thread copy for HexDump; transfer the original buffer to
    // the Worker so it owns a second copy for slice requests (attachments).
    const mainCopy = new Uint8Array(buffer.slice(0));
    setBytes(mainCopy);
    setFileName(file.name);
    setSummary(null);
    setParseError(null);
    setProgress({ stage: 'scan', progress: 0 });
    setSelectedThreadId(undefined);
    setJumpOffset(undefined);

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
  }, []);

  const selectedThread = useMemo(() => {
    if (!summary) return undefined;
    return summary.threads.find((t) => t.id === selectedThreadId);
  }, [summary, selectedThreadId]);

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
        }}
      >
        <strong style={{ fontSize: 16 }}>PlusMessage Backup Viewer</strong>
        <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
          ブラウザ内で完結。ファイルは送信されません。
        </span>
        {bytes && fileName && (
          <span style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: 12 }}>
            {fileName} ({bytes.byteLength.toLocaleString()} B)
          </span>
        )}
      </header>

      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 20, gap: 16 }}>
        {!bytes ? (
          <>
            <PrivacyBanner />
            <FilePicker onFile={(file, buffer) => handleFile(file, buffer)} />
          </>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0, flex: 1 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button onClick={handleReset}>別のファイルを読み込む</button>
              <label style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <input
                  type="checkbox"
                  checked={showDebug}
                  onChange={(e) => setShowDebug(e.target.checked)}
                />
                デバッグビュー (TLV + hex)
              </label>
              {parseInFlight && <ProgressIndicator progress={progress} />}
              {parseError && (
                <span style={{ color: 'var(--danger, #c33)', fontSize: 12 }}>
                  parse error: {parseError}
                </span>
              )}
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 12,
                minHeight: 0,
                flex: 1,
              }}
            >
              {showDebug ? (
                <>
                  {summary ? (
                    <TlvTree backup={summary} onJumpTo={setJumpOffset} />
                  ) : (
                    <PlaceholderBox
                      message={
                        parseError
                          ? 'パース結果を表示できません。'
                          : 'パース中…'
                      }
                    />
                  )}
                  <HexDump bytes={bytes} jumpToOffset={jumpOffset} />
                </>
              ) : summary ? (
                <>
                  <ThreadList
                    backup={summary}
                    selectedId={selectedThreadId}
                    onSelect={setSelectedThreadId}
                  />
                  <ThreadDetail
                    thread={selectedThread}
                    client={client}
                    onJumpToOffset={(off) => {
                      setJumpOffset(off);
                      setShowDebug(true);
                    }}
                  />
                </>
              ) : (
                <PlaceholderBox
                  message={
                    parseError
                      ? 'パース結果を表示できません。デバッグビューで生バイトを確認できます。'
                      : 'パース中…'
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
        <span>🔒 ローカル処理</span>
        <span>v0.1.0</span>
      </footer>
    </div>
  );
}

function ProgressIndicator({ progress }: { progress: ParseProgress | null }) {
  const value = progress?.progress ?? 0;
  const stage = progress?.stage ?? 'scan';
  const note = progress?.note;
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
      <progress value={value} max={1} style={{ width: 120 }} />
      <span>
        {stage}
        {note ? ` — ${note}` : ''} ({Math.round(value * 100)}%)
      </span>
    </span>
  );
}

function PlaceholderBox({ message }: { message: string }) {
  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 6,
        padding: 12,
        background: 'var(--bg-elev)',
        fontSize: 12,
        color: 'var(--text-muted)',
      }}
    >
      {message}
    </div>
  );
}
