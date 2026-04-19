import type { BackupSummary, ThreadSummary } from '../parser/types';

interface Props {
  backup: BackupSummary;
  selectedId?: string | undefined;
  onSelect: (id: string) => void;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export function ThreadList({ backup, selectedId, onSelect }: Props) {
  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 6,
        background: 'var(--bg-elev)',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        flex: 1,
      }}
    >
      <div
        style={{
          padding: '8px 12px',
          borderBottom: '1px solid var(--border)',
          fontSize: 12,
          color: 'var(--text-muted)',
        }}
      >
        <strong style={{ color: 'var(--text)' }}>{backup.threads.length}</strong> threads
        <span style={{ marginLeft: 8 }}>
          · メッセージ本文は次ステップで解析予定
        </span>
      </div>
      <div style={{ overflow: 'auto', flex: 1 }}>
        {backup.threads.map((t) => (
          <ThreadRow
            key={t.id}
            thread={t}
            selected={t.id === selectedId}
            onClick={() => onSelect(t.id)}
          />
        ))}
      </div>
    </div>
  );
}

function ThreadRow({
  thread,
  selected,
  onClick,
}: {
  thread: ThreadSummary;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'grid',
        gridTemplateColumns: '80px 1fr 110px',
        gap: 8,
        padding: '8px 12px',
        width: '100%',
        textAlign: 'left',
        border: 'none',
        borderBottom: '1px dashed var(--border)',
        background: selected ? 'var(--bg-sunken)' : 'transparent',
        color: 'var(--text)',
        cursor: 'pointer',
        fontSize: 13,
        fontFamily: 'inherit',
      }}
    >
      <span style={{ color: 'var(--accent)', fontFamily: 'var(--mono)' }}>
        #{thread.threadId}
      </span>
      <span style={{ color: 'var(--text-muted)' }}>
        strings: {thread.strings.length} · flag 0x{thread.headerFlag.toString(16).padStart(2, '0')}
      </span>
      <span style={{ color: 'var(--text-muted)', textAlign: 'right' }}>
        {formatBytes(thread.bodyLength)}
      </span>
    </button>
  );
}
