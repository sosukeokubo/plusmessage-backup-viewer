import { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { InboxMessage, ThreadSummary } from '../parser/types';
import type { ResolvedContact } from '../util/contactResolver';
import { Avatar } from './Avatar';
import { SORT_LABELS, type ThreadSort } from '../util/threadSort';

interface Props {
  totalCount: number;
  selectedId?: string | undefined;
  onSelect: (id: string) => void;
  threads: ThreadSummary[];
  resolveContact: (thread: ThreadSummary) => ResolvedContact;
  inboxFor: (thread: ThreadSummary) => readonly InboxMessage[] | undefined;
  sort: ThreadSort;
  searchQuery: string;
  onSearchChange: (q: string) => void;
}

const ROW_HEIGHT = 72;

export function ThreadList({
  totalCount,
  selectedId,
  onSelect,
  threads,
  resolveContact,
  inboxFor,
  sort,
  searchQuery,
  onSearchChange,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: threads.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  const showingAll = threads.length === totalCount;

  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 8,
        background: 'var(--bg-elev)',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        flex: 1,
      }}
    >
      <div
        style={{
          padding: '10px 12px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="名前・電話番号で検索"
          aria-label="会話を検索"
          style={{
            width: '100%',
            padding: '6px 10px',
            borderRadius: 6,
            border: '1px solid var(--border)',
            background: 'var(--bg)',
            color: 'var(--text)',
            fontFamily: 'inherit',
            fontSize: 13,
          }}
        />
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {showingAll ? (
            <>
              会話 <strong style={{ color: 'var(--text)' }}>{totalCount}</strong> 件 ·{' '}
              {SORT_LABELS[sort]}
            </>
          ) : (
            <>
              <strong style={{ color: 'var(--text)' }}>{threads.length}</strong> 件 /{' '}
              {totalCount} 件中
            </>
          )}
        </div>
      </div>
      <div ref={scrollRef} style={{ overflow: 'auto', flex: 1 }}>
        {threads.length === 0 ? (
          <div
            style={{
              padding: 24,
              textAlign: 'center',
              color: 'var(--text-muted)',
              fontSize: 13,
            }}
          >
            該当する会話がありません。
          </div>
        ) : (
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
              const contact = resolveContact(t);
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
                    contact={contact}
                    inbox={inboxFor(t)}
                    selected={t.id === selectedId}
                    onClick={() => onSelect(t.id)}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function ThreadRow({
  thread,
  contact,
  inbox,
  selected,
  onClick,
}: {
  thread: ThreadSummary;
  contact: ResolvedContact;
  inbox?: readonly InboxMessage[] | undefined;
  selected: boolean;
  onClick: () => void;
}) {
  const inboxCount = inbox?.length ?? 0;
  const latestInboxText = inbox && inbox.length > 0
    ? inbox.reduce((latest, m) =>
        m.timestamp.ms > latest.timestamp.ms ? m : latest,
      ).text
    : '';
  const preview = latestInboxText.trim();
  const photoCount = thread.attachments.length;
  const fallback = photoCount > 0 ? '写真のみ' : '表示できるテキストはありません';

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'grid',
        gridTemplateColumns: '40px 1fr',
        columnGap: 10,
        rowGap: 2,
        padding: '10px 12px',
        width: '100%',
        height: '100%',
        textAlign: 'left',
        border: 'none',
        borderBottom: '1px solid var(--border)',
        background: selected ? 'var(--accent-weak)' : 'transparent',
        color: 'var(--text)',
        cursor: 'pointer',
        fontFamily: 'inherit',
        alignItems: 'center',
      }}
    >
      <span style={{ gridRow: '1 / span 2' }}>
        <Avatar contact={contact} size={40} />
      </span>
      <span
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 8,
          minWidth: 0,
        }}
      >
        <span
          style={{
            fontSize: 14,
            fontWeight: 600,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
            minWidth: 0,
          }}
          title={contact.sourceId ?? contact.displayName}
        >
          {contact.displayName}
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>
          {[
            inboxCount > 0 ? `メッセージ${inboxCount}` : '',
            photoCount > 0 ? `写真${photoCount}` : '',
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </span>
      <span
        style={{
          fontSize: 12,
          color: 'var(--text-muted)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          minWidth: 0,
        }}
        title={preview}
      >
        {preview || fallback}
      </span>
    </button>
  );
}
