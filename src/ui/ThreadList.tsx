import { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { BackupSummary, ThreadSummary } from '../parser/types';
import type { ThreadSort } from './SortControls';

interface Props {
  backup: BackupSummary;
  selectedId?: string | undefined;
  onSelect: (id: string) => void;
  threads: ThreadSummary[];
  sort: ThreadSort;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

const ROW_HEIGHT = 40;

export function ThreadList({ backup, selectedId, onSelect, threads, sort }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: threads.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

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
        <span style={{ marginLeft: 8 }}>·</span>
        <span style={{ marginLeft: 8 }}>{labelForSort(sort)}</span>
      </div>
      <div ref={scrollRef} style={{ overflow: 'auto', flex: 1 }}>
        <div
          style={{
            height: virtualizer.getTotalSize(),
            position: 'relative',
            width: '100%',
          }}
        >
          {virtualizer.getVirtualItems().map((v) => {
            const t = threads[v.index];
            if (!t) return null;
            return (
              <div
                key={t.id}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${v.start}px)`,
                  height: v.size,
                }}
              >
                <ThreadRow
                  thread={t}
                  selected={t.id === selectedId}
                  onClick={() => onSelect(t.id)}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function labelForSort(sort: ThreadSort): string {
  switch (sort) {
    case 'file-order':
      return 'ファイル順';
    case 'body-size':
      return 'サイズ降順';
    case 'string-count':
      return '文字列数降順';
  }
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
        height: '100%',
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
