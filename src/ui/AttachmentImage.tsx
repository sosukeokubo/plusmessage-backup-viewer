import { useEffect, useRef, useState } from 'react';
import type { AttachmentRef } from '../parser/types';
import type { ParserClient } from '../worker/parserClient';
import { getCachedBlobUrl, setCachedBlobUrl } from '../util/blobCache';

interface Props {
  client: ParserClient;
  attachment: AttachmentRef;
  onJumpToOffset?: ((offset: number) => void) | undefined;
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
export function AttachmentImage({ client, attachment, onJumpToOffset }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<State>(() => {
    const cached = getCachedBlobUrl(attachment.sourceOffset, attachment.length);
    return cached ? { status: 'ready', url: cached } : { status: 'idle' };
  });

  useEffect(() => {
    if (state.status !== 'idle') return;
    const el = containerRef.current;
    if (!el) return;

    let cancelled = false;

    const load = () => {
      const cached = getCachedBlobUrl(attachment.sourceOffset, attachment.length);
      if (cached) {
        setState({ status: 'ready', url: cached });
        return;
      }
      setState({ status: 'loading' });
      client
        .getSlice(attachment.sourceOffset, attachment.length)
        .then((bytes) => {
          if (cancelled) return;
          // Worker-transferred bytes always have a plain ArrayBuffer backing,
          // but structured-clone widens the type to ArrayBufferLike. The Blob
          // constructor only accepts ArrayBuffer — cast to bridge the gap.
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
  }, [client, attachment.sourceOffset, attachment.length, attachment.contentType, state.status]);

  const sizeKb = (attachment.length / 1024).toFixed(1);
  const offsetLabel = `0x${attachment.sourceOffset.toString(16)}`;

  return (
    <div
      ref={containerRef}
      style={{
        border: '1px solid var(--border)',
        borderRadius: 6,
        background: 'var(--bg-sunken)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          aspectRatio: '1 / 1',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--bg)',
        }}
      >
        {state.status === 'ready' ? (
          <img
            src={state.url}
            alt={`attachment at ${offsetLabel}`}
            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
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
      </div>
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
        <span>{sizeKb} KB</span>
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
    </div>
  );
}
