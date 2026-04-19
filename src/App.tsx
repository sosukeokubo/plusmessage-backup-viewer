import { useMemo, useState } from 'react';
import { FilePicker } from './ui/FilePicker';
import { PrivacyBanner } from './ui/PrivacyBanner';
import { ThreadList } from './ui/ThreadList';
import { ThreadDetail } from './ui/ThreadDetail';
import { HexDump } from './debug/HexDump';
import { TlvTree } from './debug/TlvTree';
import { parseBackup } from './parser';
import type { Backup } from './parser/types';

interface ParseResult {
  backup?: Backup;
  error?: string;
}

export function App() {
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [jumpOffset, setJumpOffset] = useState<number | undefined>(undefined);
  const [showDebug, setShowDebug] = useState(false);
  const [selectedThreadId, setSelectedThreadId] = useState<string | undefined>(undefined);

  const parseResult = useMemo<ParseResult | null>(() => {
    if (!bytes) return null;
    try {
      return { backup: parseBackup(bytes) };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }, [bytes]);

  const selectedThread = useMemo(() => {
    if (!parseResult?.backup) return undefined;
    return parseResult.backup.threads.find((t) => t.id === selectedThreadId);
  }, [parseResult, selectedThreadId]);

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
            <FilePicker
              onFile={(file, buffer) => {
                setFileName(file.name);
                setBytes(new Uint8Array(buffer));
              }}
            />
          </>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0, flex: 1 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button
                onClick={() => {
                  setBytes(null);
                  setFileName(null);
                  setJumpOffset(undefined);
                  setSelectedThreadId(undefined);
                }}
              >
                別のファイルを読み込む
              </button>
              <label style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <input
                  type="checkbox"
                  checked={showDebug}
                  onChange={(e) => setShowDebug(e.target.checked)}
                />
                デバッグビュー (TLV + hex)
              </label>
              {parseResult?.error && (
                <span style={{ color: 'var(--danger, #c33)', fontSize: 12 }}>
                  parse error: {parseResult.error}
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
                  {parseResult?.backup ? (
                    <TlvTree backup={parseResult.backup} onJumpTo={setJumpOffset} />
                  ) : (
                    <PlaceholderBox message="パース結果を表示できません。" />
                  )}
                  <HexDump bytes={bytes} jumpToOffset={jumpOffset} />
                </>
              ) : parseResult?.backup ? (
                <>
                  <ThreadList
                    backup={parseResult.backup}
                    selectedId={selectedThreadId}
                    onSelect={setSelectedThreadId}
                  />
                  <ThreadDetail
                    thread={selectedThread}
                    onJumpToOffset={(off) => {
                      setJumpOffset(off);
                      setShowDebug(true);
                    }}
                  />
                </>
              ) : (
                <PlaceholderBox message="パース結果を表示できません。デバッグビューで生バイトを確認できます。" />
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
