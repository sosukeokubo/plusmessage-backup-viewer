import { useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { AttachmentRef, InboxMessage, ThreadSummary } from '../parser/types';
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
  inboxMessages?: readonly InboxMessage[] | undefined;
  debug?: boolean;
  onJumpToOffset?: ((offset: number) => void) | undefined;
}

const dateTimeFormatter = new Intl.DateTimeFormat('ja-JP', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

function formatInboxTimestamp(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '';
  try {
    return dateTimeFormatter.format(new Date(ms));
  } catch {
    return '';
  }
}

const STRING_ROW_HEIGHT = 44;

/** One entry of the merged conversation view, ordered by `ms`. */
type TimelineEntry =
  | { key: string; ms: number; kind: 'text'; message: InboxMessage }
  | { key: string; ms: number; kind: 'media'; attachment: AttachmentRef };

export function ThreadDetail({
  thread,
  contact,
  client,
  inboxMessages,
  debug = false,
  onJumpToOffset,
}: Props) {
  const [lightbox, setLightbox] = useState<string | null>(null);

  const visibleStrings = useMemo(() => {
    if (!thread) return [];
    return debug ? thread.strings : filterMessageStrings(thread.strings);
  }, [thread, debug]);

  // Text bodies and media arrive from different sections but describe one
  // conversation, so they are merged into a single ordered list rather than
  // shown as two stacked blocks. Attachments whose delivery record could not
  // be matched have no timestamp and keep the old grid below.
  const { timeline, undatedAttachments } = useMemo(() => {
    const entries: TimelineEntry[] = [];
    for (const message of inboxMessages ?? []) {
      entries.push({
        key: `msg:${message.id}:${message.offset}`,
        ms: message.timestamp.ms,
        kind: 'text',
        message,
      });
    }
    const undated: AttachmentRef[] = [];
    for (const attachment of thread?.attachments ?? []) {
      if (attachment.timestamp) {
        entries.push({
          key: `att:${attachment.sourceOffset}:${attachment.length}`,
          ms: attachment.timestamp.ms,
          kind: 'media',
          attachment,
        });
      } else {
        undated.push(attachment);
      }
    }
    entries.sort((a, b) => a.ms - b.ms);
    return { timeline: entries, undatedAttachments: undated };
  }, [inboxMessages, thread]);

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
  const messageCount = timeline.filter((e) => e.kind === 'text').length;
  const headerSummary = [
    messageCount > 0 ? `メッセージ ${messageCount} 件` : null,
    photoCount > 0 ? `写真 ${photoCount} 枚` : null,
    shownStrings > 0 ? `テキスト断片 ${shownStrings} 件` : null,
  ]
    .filter(Boolean)
    .join(' · ');

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
              title={contact.sourceId ?? contact.displayName}
            >
              {contact.displayName}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {headerSummary || 'データなし'}
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
          💡 バックアップから復元できたメッセージを表示しています。一部のテキストは断片として
          表示される場合があります。
        </div>

        {timeline.length > 0 && (
          <section style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
            <h3 style={{ fontSize: 13, margin: '0 0 8px', color: 'var(--text-muted)' }}>
              会話 {timeline.length} 件
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {timeline.map((entry) =>
                entry.kind === 'text' ? (
                  <InboxBubble key={entry.key} message={entry.message} />
                ) : client ? (
                  <MediaBubble
                    key={entry.key}
                    client={client}
                    attachment={entry.attachment}
                    debug={debug}
                    onJumpToOffset={debug ? onJumpToOffset : undefined}
                    onOpen={(url) => setLightbox(url)}
                  />
                ) : null,
              )}
            </div>
          </section>
        )}

        {undatedAttachments.length > 0 && client && (
          <section style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
            <h3 style={{ fontSize: 13, margin: '0 0 8px', color: 'var(--text-muted)' }}>
              日時が特定できなかった写真 {undatedAttachments.length} 枚
            </h3>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
                gap: 8,
              }}
            >
              {undatedAttachments.map((a) => (
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

        {(debug || shownStrings > 0) && (
          <div
            style={{
              padding: '10px 16px 6px',
              display: 'flex',
              alignItems: 'baseline',
              gap: 8,
            }}
          >
            <h3 style={{ fontSize: 13, margin: 0, color: 'var(--text-muted)' }}>
              取り出せたテキスト断片
            </h3>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {debug
                ? `${totalStrings} 件（フィルタ解除）`
                : shownStrings === totalStrings
                  ? `${shownStrings} 件`
                  : `${shownStrings} 件（元 ${totalStrings} 件中）`}
            </span>
          </div>
        )}

        <div ref={stringsScrollRef} style={{ overflow: 'auto', flex: 1 }}>
          {shownStrings === 0 ? (
            debug ? (
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
            ) : null
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

function InboxBubble({ message }: { message: InboxMessage }) {
  const stamp = formatInboxTimestamp(message.timestamp.ms);
  const body = message.text.trim();
  const hasText = body.length > 0;
  const isOutgoing = message.direction === 'outgoing';
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: isOutgoing ? 'flex-end' : 'flex-start',
        alignSelf: isOutgoing ? 'flex-end' : 'flex-start',
        maxWidth: '80%',
      }}
    >
      <div
        style={{
          background: isOutgoing ? 'var(--accent)' : 'var(--accent-weak)',
          color: isOutgoing ? 'var(--accent-contrast, #fff)' : 'var(--text)',
          border: isOutgoing ? '1px solid var(--accent)' : '1px solid var(--border)',
          borderRadius: 12,
          padding: '8px 12px',
          fontSize: 14,
          lineHeight: 1.5,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {hasText ? body : <span style={{ color: 'var(--text-muted)' }}>（本文なし）</span>}
      </div>
      {stamp && (
        <div
          style={{
            fontSize: 11,
            color: 'var(--text-muted)',
            marginTop: 2,
            paddingLeft: isOutgoing ? 0 : 4,
            paddingRight: isOutgoing ? 4 : 0,
          }}
        >
          {stamp}
        </div>
      )}
    </div>
  );
}

/**
 * A media file in the conversation flow, aligned like a text bubble.
 *
 * Stickers are rendered without bubble chrome: in +message they are artwork
 * dropped into the conversation, not a boxed attachment, and framing them
 * like a photo misrepresents what the user actually saw.
 */
function MediaBubble({
  client,
  attachment,
  debug,
  onJumpToOffset,
  onOpen,
}: {
  client: ParserClient;
  attachment: AttachmentRef;
  debug: boolean;
  onJumpToOffset?: ((offset: number) => void) | undefined;
  onOpen: (url: string) => void;
}) {
  const isOutgoing = attachment.direction === 'outgoing';
  const stamp = attachment.timestamp ? formatInboxTimestamp(attachment.timestamp.ms) : '';
  const sticker = attachment.isSticker === true;
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: isOutgoing ? 'flex-end' : 'flex-start',
        alignSelf: isOutgoing ? 'flex-end' : 'flex-start',
        maxWidth: sticker ? 200 : 260,
      }}
    >
      <AttachmentImage
        client={client}
        attachment={attachment}
        debug={debug}
        onJumpToOffset={onJumpToOffset}
        onOpen={onOpen}
        variant={sticker ? 'bare' : 'tile'}
      />
      {stamp && (
        <div
          style={{
            fontSize: 11,
            color: 'var(--text-muted)',
            marginTop: 2,
            paddingLeft: isOutgoing ? 0 : 4,
            paddingRight: isOutgoing ? 4 : 0,
          }}
        >
          {stamp}
        </div>
      )}
    </div>
  );
}
