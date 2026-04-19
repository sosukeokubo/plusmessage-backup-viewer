import { useCallback, useRef, useState } from 'react';

interface Props {
  onFile: (file: File, buffer: ArrayBuffer) => void;
}

export function FilePicker({ onFile }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);
      setLoading(true);
      try {
        const buffer = await file.arrayBuffer();
        onFile(file, buffer);
      } catch (e) {
        setError(`ファイル読み込み失敗: ${(e as Error).message}`);
      } finally {
        setLoading(false);
      }
    },
    [onFile],
  );

  return (
    <section
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer.files[0];
        if (file) void handleFile(file);
      }}
      style={{
        border: `2px dashed ${dragging ? 'var(--accent)' : 'var(--border)'}`,
        background: dragging ? 'var(--accent-weak)' : 'var(--bg-elev)',
        padding: '48px 24px',
        borderRadius: 'var(--radius)',
        textAlign: 'center',
        maxWidth: 720,
        transition: 'all 0.12s ease',
      }}
    >
      <p style={{ fontSize: 16, margin: '0 0 12px' }}>
        <strong>PlusMessage.backup</strong> をここにドロップ
      </p>
      <p style={{ color: 'var(--text-muted)', margin: '0 0 16px' }}>または</p>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        style={{
          padding: '8px 16px',
          borderRadius: 6,
          border: '1px solid var(--border)',
          background: 'var(--bg)',
          color: 'var(--text)',
        }}
      >
        ファイルを選択
      </button>
      <input
        ref={inputRef}
        type="file"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />
      {loading && <p style={{ marginTop: 16, color: 'var(--text-muted)' }}>読込中…</p>}
      {error && <p style={{ marginTop: 16, color: 'var(--danger)' }}>{error}</p>}
    </section>
  );
}
