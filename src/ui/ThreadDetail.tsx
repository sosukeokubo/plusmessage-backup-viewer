import { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { ThreadSummary } from '../parser/types';
import type { ParserClient } from '../worker/parserClient';
import { AttachmentImage } from './AttachmentImage';

interface Props {
  thread?: ThreadSummary | undefined;
  client?: ParserClient | null | undefined;
  onJumpToOffset?: ((offset: number) => void) | undefined;
}

const STRING_ROW_HEIGHT = 28;

export function ThreadDetail({ thread, client, onJumpToOffset }: Props) {
  const stringsScrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: thread?.strings.length ?? 0,
    getScrollElement: () => stringsScrollRef.current,
    estimateSize: () => STRING_ROW_HEIGHT,
    overscan: 12,
  });

  if (!thread) {
    return (
      <div
        style={{
          border: '1px solid var(--border)',
          borderRadius: 6,
          background: 'var(--bg-elev)',
          padding: 16,
          color: 'var(--text-muted)',
          fontSize: 13,
        }}
      >
        左のリストから thread を選択してください。
      </div>
    );
  }

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
          display: 'flex',
          gap: 16,
          flexWrap: 'wrap',
          fontSize: 12,
        }}
      >
        <span>
          <strong>#{thread.threadId}</strong>
        </span>
        <span>
          body: <strong>{thread.bodyLength.toLocaleString()}</strong> B
        </span>
        <span>
          flag: <code>0x{thread.headerFlag.toString(16).padStart(2, '0')}</code>
        </span>
        <span>
          size-field: <code>{thread.headerSizeField.toLocaleString()}</code>
        </span>
        <span>
          strings: <strong>{thread.strings.length}</strong>
        </span>
        <span>
          attachments: <strong>{thread.attachments.length}</strong>
        </span>
      </div>
      {thread.attachments.length > 0 && client && (
        <div
          style={{
            padding: '12px',
            borderBottom: '1px solid var(--border)',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
            gap: 8,
          }}
        >
          {thread.attachments.map((a) => (
            <AttachmentImage
              key={`${a.sourceOffset}:${a.length}`}
              client={client}
              attachment={a}
              onJumpToOffset={onJumpToOffset}
            />
          ))}
        </div>
      )}
      <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text-muted)' }}>
        メッセージ本文は未デコード。JPEG/PNG 添付はバイナリパターン検出。
        以下は thread 本体に含まれる印字可能 ASCII 文字列の抜粋です。
      </div>
      <div
        style={{
          padding: '4px 12px',
          display: 'grid',
          gridTemplateColumns: '110px 60px 1fr 60px',
          gap: 8,
          fontSize: 12,
          color: 'var(--text-muted)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <span>offset</span>
        <span>len</span>
        <span>text</span>
        <span />
      </div>
      <div ref={stringsScrollRef} style={{ overflow: 'auto', flex: 1 }}>
        <div
          style={{
            height: virtualizer.getTotalSize(),
            position: 'relative',
            width: '100%',
          }}
        >
          {virtualizer.getVirtualItems().map((v) => {
            const s = thread.strings[v.index];
            if (!s) return null;
            return (
              <div
                key={s.offset}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${v.start}px)`,
                  height: v.size,
                  display: 'grid',
                  gridTemplateColumns: '110px 60px 1fr 60px',
                  gap: 8,
                  alignItems: 'center',
                  padding: '0 12px',
                  borderBottom: '1px dashed var(--border)',
                  fontSize: 12,
                  fontFamily: 'var(--mono)',
                }}
              >
                <span style={{ color: 'var(--text-muted)' }}>
                  0x{s.offset.toString(16).padStart(8, '0')}
                </span>
                <span style={{ color: 'var(--text-muted)' }}>{s.length}</span>
                <span
                  style={{
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                  title={s.text}
                >
                  {s.text}
                </span>
                <span style={{ textAlign: 'right' }}>
                  {onJumpToOffset && (
                    <button
                      type="button"
                      onClick={() => onJumpToOffset(s.offset)}
                      style={{ fontSize: 11, padding: '2px 6px' }}
                    >
                      hex へ
                    </button>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
