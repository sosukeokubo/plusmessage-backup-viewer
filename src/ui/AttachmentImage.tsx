import { useEffect, useRef, useState } from 'react';
import type { AttachmentRef } from '../parser/types';
import type { ParserClient } from '../worker/parserClient';
import { getCachedBlobUrl, setCachedBlobUrl } from '../util/blobCache';

interface Props {
  client: ParserClient;
  attachment: AttachmentRef;
  debug?: boolean;
  onJumpToOffset?: ((offset: number) => void) | undefined;
  onOpen?: ((url: string) => void) | undefined;
  /**
   * 'tile' is the square, framed cell used by the attachment grid. 'bare'
   * drops the frame and lets the image keep its own shape — how a sticker
   * appears in the +message app, where it is not boxed like a photo.
   */
  variant?: 'tile' | 'bare';
}

type State =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; url: string }
  | { status: 'error'; message: string };

/**
 * Lazy-loading image tile for a single attachment. The tile placeholder is
 * rendered immediately and registered with an IntersectionObserver; the
 * Worker is only asked for bytes when the tile actually scrolls into view.
 * Resolved Blob URLs go through a shared LRU cache so scrolling back doesn't
 * re-fetch.
 */
export function AttachmentImage({
  client,
  attachment,
  debug = false,
  onJumpToOffset,
  onOpen,
  variant = 'tile',
}: Props) {
  const bare = variant === 'bare';
  const containerRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<State>(() => {
    const cached = getCachedBlobUrl(attachment.sourceOffset, attachment.length);
    return cached ? { status: 'ready', url: cached } : { status: 'idle' };
  });

  // Ref mirrors the latest status so the observer-installed effect can stay
  // mounted once and check whether a load has already fired. Including
  // `state.status` in the effect's dep array would re-run it on idle→loading,
  // and its cleanup would flip `cancelled` to true before the in-flight
  // resolveAttachment Promise resolves — silently suppressing the `ready`
  // state update.
  const statusRef = useRef(state.status);
  statusRef.current = state.status;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (statusRef.current !== 'idle') return;

    let cancelled = false;

    const load = () => {
      const cached = getCachedBlobUrl(attachment.sourceOffset, attachment.length);
      if (cached) {
        setState({ status: 'ready', url: cached });
        return;
      }
      setState({ status: 'loading' });
      client
        .resolveAttachment(attachment)
        .then((bytes) => {
          if (cancelled) return;
          const blob = new Blob([bytes as BlobPart], { type: attachment.contentType });
          const url = URL.createObjectURL(blob);
          setCachedBlobUrl(attachment.sourceOffset, attachment.length, url);
          setState({ status: 'ready', url });
        })
        .catch((err: Error) => {
          if (cancelled) return;
          setState({ status: 'error', message: err.message });
        });
    };

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          observer.disconnect();
          load();
        }
      },
      { rootMargin: '200px' },
    );
    observer.observe(el);

    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [client, attachment]);

  const ready = state.status === 'ready';
  const canOpen = ready && onOpen;
  const offsetLabel = `0x${attachment.sourceOffset.toString(16)}`;

  return (
    <div
      ref={containerRef}
      style={{
        border: bare ? 'none' : '1px solid var(--border)',
        borderRadius: 8,
        background: bare ? 'transparent' : 'var(--bg-sunken)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <button
        type="button"
        disabled={!canOpen}
        onClick={() => {
          if (state.status === 'ready' && onOpen) onOpen(state.url);
        }}
        aria-label={ready ? '写真を拡大表示' : '写真の読み込みを待機中'}
        style={{
          aspectRatio: bare ? undefined : '1 / 1',
          minHeight: bare ? 72 : undefined,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: bare ? 'transparent' : 'var(--bg)',
          border: 'none',
          padding: 0,
          cursor: canOpen ? 'zoom-in' : 'default',
          width: '100%',
        }}
      >
        {state.status === 'ready' ? (
          <img
            src={state.url}
            alt={attachment.isSticker ? 'スタンプ' : '添付写真'}
            style={{ maxWidth: '100%', maxHeight: bare ? 200 : '100%', objectFit: 'contain' }}
          />
        ) : state.status === 'error' ? (
          <span style={{ color: 'var(--danger, #c33)', fontSize: 11, padding: 8 }}>
            {state.message}
          </span>
        ) : (
          <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
            {state.status === 'loading' ? '読込中…' : 'スクロールで読込'}
          </span>
        )}
      </button>
      {debug && (
        <div
          style={{
            padding: '4px 8px',
            fontSize: 11,
            color: 'var(--text-muted)',
            display: 'flex',
            gap: 6,
            alignItems: 'center',
            fontFamily: 'var(--mono)',
            borderTop: '1px solid var(--border)',
          }}
        >
          <span>{attachment.contentType}</span>
          <span>·</span>
          <span>{(attachment.length / 1024).toFixed(1)} KB</span>
          <span style={{ marginLeft: 'auto' }}>
            {onJumpToOffset ? (
              <button
                type="button"
                onClick={() => onJumpToOffset(attachment.sourceOffset)}
                style={{ fontSize: 11, padding: '1px 6px' }}
                title={`jump hex to ${offsetLabel}`}
              >
                {offsetLabel}
              </button>
            ) : (
              <span>{offsetLabel}</span>
            )}
          </span>
        </div>
      )}
    </div>
  );
}
