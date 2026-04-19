import type { ThreadSummary } from '../parser/types';
import type { ParserClient } from '../worker/parserClient';
import { AttachmentImage } from './AttachmentImage';

interface Props {
  thread?: ThreadSummary | undefined;
  client?: ParserClient | null | undefined;
  onJumpToOffset?: ((offset: number) => void) | undefined;
}

export function ThreadDetail({ thread, client, onJumpToOffset }: Props) {
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
        メッセージ本文は未デコード。JPEG 添付は SOI/EOI スキャンで検出。PNG (zlib) は Step 8 で対応。
        以下は thread 本体に含まれる印字可能 ASCII 文字列の抜粋です。
      </div>
      <div style={{ overflow: 'auto', flex: 1, padding: '0 12px 12px' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--text-muted)' }}>
              <th style={{ padding: '4px 8px', width: 110 }}>offset</th>
              <th style={{ padding: '4px 8px', width: 60 }}>len</th>
              <th style={{ padding: '4px 8px' }}>text</th>
              <th style={{ padding: '4px 8px', width: 60 }}></th>
            </tr>
          </thead>
          <tbody>
            {thread.strings.map((s) => (
              <tr key={s.offset} style={{ borderBottom: '1px dashed var(--border)' }}>
                <td
                  style={{
                    padding: '4px 8px',
                    fontFamily: 'var(--mono)',
                    color: 'var(--text-muted)',
                  }}
                >
                  0x{s.offset.toString(16).padStart(8, '0')}
                </td>
                <td
                  style={{
                    padding: '4px 8px',
                    fontFamily: 'var(--mono)',
                    color: 'var(--text-muted)',
                  }}
                >
                  {s.length}
                </td>
                <td
                  style={{
                    padding: '4px 8px',
                    fontFamily: 'var(--mono)',
                    wordBreak: 'break-all',
                  }}
                >
                  {s.text}
                </td>
                <td style={{ padding: '4px 8px', textAlign: 'right' }}>
                  {onJumpToOffset && (
                    <button
                      type="button"
                      onClick={() => onJumpToOffset(s.offset)}
                      style={{ fontSize: 11, padding: '2px 6px' }}
                    >
                      hex へ
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
