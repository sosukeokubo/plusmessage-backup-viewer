import { useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { ThreadSummary } from '../parser/types';
import type { ParserClient } from '../worker/parserClient';
import type { ResolvedContact } from '../util/contactResolver';
import { filterMessageStrings } from '../util/stringFilter';
import { AttachmentImage } from './AttachmentImage';
import { Avatar } from './Avatar';
import { Lightbox } from './Lightbox';

interface Props {
  thread?: ThreadSummary | undefined;
  contact?: ResolvedContact | undefined;
  client?: ParserClient | null | undefined;
  debug?: boolean;
  onJumpToOffset?: ((offset: number) => void) | undefined;
}

const STRING_ROW_HEIGHT = 44;

export function ThreadDetail({
  thread,
  contact,
  client,
  debug = false,
  onJumpToOffset,
}: Props) {
  const [lightbox, setLightbox] = useState<string | null>(null);

  const visibleStrings = useMemo(() => {
    if (!thread) return [];
    return debug ? thread.strings : filterMessageStrings(thread.strings);
  }, [thread, debug]);

  const stringsScrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: visibleStrings.length,
    getScrollElement: () => stringsScrollRef.current,
    estimateSize: () => STRING_ROW_HEIGHT,
    overscan: 12,
  });

  if (!thread || !contact) {
    return (
      <div
        style={{
          border: '1px solid var(--border)',
          borderRadius: 8,
          background: 'var(--bg-elev)',
          padding: 24,
          color: 'var(--text-muted)',
          fontSize: 13,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 200,
        }}
      >
        左から会話を選んでください。
      </div>
    );
  }

  const photoCount = thread.attachments.length;
  const totalStrings = thread.strings.length;
  const shownStrings = visibleStrings.length;

  return (
    <>
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
            padding: '12px 16px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <Avatar contact={contact} size={40} />
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
            <div
              style={{
                fontSize: 15,
                fontWeight: 600,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={contact.displayName}
            >
              {contact.displayName}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              写真 {photoCount} 枚 · テキスト {shownStrings} 件
            </div>
          </div>
        </div>

        {debug && (
          <div
            style={{
              padding: '6px 16px',
              borderBottom: '1px solid var(--border)',
              fontSize: 11,
              fontFamily: 'var(--mono)',
              color: 'var(--text-muted)',
              display: 'flex',
              flexWrap: 'wrap',
              gap: 12,
            }}
          >
            <span>#{thread.threadId}</span>
            <span>body: {thread.bodyLength.toLocaleString()} B</span>
            <span>flag: 0x{thread.headerFlag.toString(16).padStart(2, '0')}</span>
            <span>size-field: {thread.headerSizeField.toLocaleString()}</span>
            <span>strings: {thread.strings.length}</span>
            <span>attachments: {thread.attachments.length}</span>
          </div>
        )}

        <div
          style={{
            padding: '10px 16px',
            borderBottom: '1px solid var(--border)',
            background: 'var(--bg-sunken)',
            color: 'var(--text-muted)',
            fontSize: 12,
            lineHeight: 1.5,
          }}
        >
          💡 このバックアップから取り出せた内容を表示しています。本文すべての完全な復元ではなく、
          一部が断片的に見えるテキストと、添付写真です。
        </div>

        {photoCount > 0 && client && (
          <section style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
            <h3 style={{ fontSize: 13, margin: '0 0 8px', color: 'var(--text-muted)' }}>
              写真 {photoCount} 枚
            </h3>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
                gap: 8,
              }}
            >
              {thread.attachments.map((a) => (
                <AttachmentImage
                  key={`${a.sourceOffset}:${a.length}`}
                  client={client}
                  attachment={a}
                  debug={debug}
                  onJumpToOffset={debug ? onJumpToOffset : undefined}
                  onOpen={(url) => setLightbox(url)}
                />
              ))}
            </div>
          </section>
        )}

        <div
          style={{
            padding: '10px 16px 6px',
            display: 'flex',
            alignItems: 'baseline',
            gap: 8,
          }}
        >
          <h3 style={{ fontSize: 13, margin: 0, color: 'var(--text-muted)' }}>
            取り出せたテキスト
          </h3>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {debug
              ? `${totalStrings} 件（フィルタ解除）`
              : shownStrings === totalStrings
                ? `${shownStrings} 件`
                : `${shownStrings} 件（元 ${totalStrings} 件中）`}
          </span>
        </div>

        <div ref={stringsScrollRef} style={{ overflow: 'auto', flex: 1 }}>
          {shownStrings === 0 ? (
            <div
              style={{
                padding: 24,
                textAlign: 'center',
                fontSize: 12,
                color: 'var(--text-muted)',
              }}
            >
              取り出せるテキストがありませんでした。
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
                const s = visibleStrings[v.index];
                if (!s) return null;
                return (
                  <div
                    key={`${s.offset}:${s.length}`}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      transform: `translateY(${v.start}px)`,
                      height: v.size,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '0 16px',
                      borderBottom: '1px solid var(--border)',
                      fontSize: 13,
                    }}
                  >
                    <span
                      style={{
                        flex: 1,
                        minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={s.text}
                    >
                      {s.text}
                    </span>
                    {debug && (
                      <>
                        <span
                          style={{
                            fontFamily: 'var(--mono)',
                            fontSize: 11,
                            color: 'var(--text-muted)',
                          }}
                        >
                          0x{s.offset.toString(16).padStart(8, '0')}
                        </span>
                        {onJumpToOffset && (
                          <button
                            type="button"
                            onClick={() => onJumpToOffset(s.offset)}
                            style={{ fontSize: 11, padding: '2px 6px' }}
                          >
                            hex へ
                          </button>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      {lightbox && <Lightbox src={lightbox} onClose={() => setLightbox(null)} />}
    </>
  );
}
