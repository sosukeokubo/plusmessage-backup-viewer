import { useEffect, useRef } from 'react';

interface Props {
  src: string;
  alt?: string;
  onClose: () => void;
}

export function Lightbox({ src, alt, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="添付画像の拡大表示"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--overlay, rgba(0, 0, 0, 0.75))',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        zIndex: 1000,
      }}
    >
      <img
        src={src}
        alt={alt ?? '添付画像'}
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: '100%',
          maxHeight: '100%',
          objectFit: 'contain',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
          borderRadius: 4,
        }}
      />
      <button
        ref={closeRef}
        type="button"
        onClick={onClose}
        aria-label="閉じる"
        style={{
          position: 'absolute',
          top: 16,
          right: 16,
          width: 40,
          height: 40,
          borderRadius: '50%',
          border: 'none',
          background: 'rgba(255, 255, 255, 0.9)',
          color: '#111',
          fontSize: 18,
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        ✕
      </button>
    </div>
  );
}
