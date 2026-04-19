import { useEffect, useMemo, useRef, useState } from 'react';

interface Props {
  bytes: Uint8Array;
  bytesPerRow?: number;
  rowHeight?: number;
  jumpToOffset?: number | undefined;
}

const HEX = '0123456789abcdef';

function formatHex(b: number): string {
  return HEX[b >> 4]! + HEX[b & 0x0f]!;
}

function formatAscii(b: number): string {
  return b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '.';
}

function formatOffset(n: number): string {
  return n.toString(16).padStart(8, '0');
}

export function HexDump({ bytes, bytesPerRow = 16, rowHeight = 20, jumpToOffset }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(400);
  const [gotoValue, setGotoValue] = useState('');

  useEffect(() => {
    if (jumpToOffset == null) return;
    if (jumpToOffset < 0 || jumpToOffset >= bytes.byteLength) return;
    const row = Math.floor(jumpToOffset / bytesPerRow);
    containerRef.current?.scrollTo({ top: row * rowHeight, behavior: 'smooth' });
  }, [jumpToOffset, bytesPerRow, rowHeight, bytes.byteLength]);

  const totalRows = Math.ceil(bytes.byteLength / bytesPerRow);
  const totalHeight = totalRows * rowHeight;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setViewportHeight(el.clientHeight);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const firstRow = Math.max(0, Math.floor(scrollTop / rowHeight) - 4);
  const visibleRows = Math.ceil(viewportHeight / rowHeight) + 8;
  const lastRow = Math.min(totalRows, firstRow + visibleRows);

  const rows = useMemo(() => {
    const out: Array<{ offset: number; hex: string; ascii: string }> = [];
    for (let i = firstRow; i < lastRow; i += 1) {
      const base = i * bytesPerRow;
      const end = Math.min(base + bytesPerRow, bytes.byteLength);
      let hex = '';
      let ascii = '';
      for (let j = base; j < end; j += 1) {
        hex += formatHex(bytes[j]!);
        if (((j - base) & 7) === 7 && j - base < bytesPerRow - 1) hex += '  ';
        else hex += ' ';
        ascii += formatAscii(bytes[j]!);
      }
      out.push({ offset: base, hex: hex.trimEnd(), ascii });
    }
    return out;
  }, [bytes, firstRow, lastRow, bytesPerRow]);

  const handleGoto = () => {
    const target = parseInt(gotoValue.replace(/^0x/, ''), 16);
    if (!Number.isFinite(target) || target < 0 || target >= bytes.byteLength) return;
    const row = Math.floor(target / bytesPerRow);
    containerRef.current?.scrollTo({ top: row * rowHeight, behavior: 'smooth' });
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        overflow: 'hidden',
        background: 'var(--bg-elev)',
        minHeight: 0,
        flex: 1,
      }}
    >
      <div
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          padding: '8px 12px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg-sunken)',
          fontSize: 12,
          color: 'var(--text-muted)',
        }}
      >
        <span>
          {bytes.byteLength.toLocaleString()} B / 0x{bytes.byteLength.toString(16)}
        </span>
        <span style={{ marginLeft: 'auto' }}>
          <label>
            goto:&nbsp;
            <input
              value={gotoValue}
              onChange={(e) => setGotoValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleGoto();
              }}
              placeholder="0x0000"
              style={{
                width: 100,
                font: 'inherit',
                fontFamily: 'var(--mono)',
                padding: '2px 6px',
                border: '1px solid var(--border)',
                background: 'var(--bg)',
                color: 'var(--text)',
                borderRadius: 4,
              }}
            />
          </label>
        </span>
      </div>

      <div
        ref={containerRef}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        style={{
          overflow: 'auto',
          flex: 1,
          fontFamily: 'var(--mono)',
          fontSize: 12,
          lineHeight: `${rowHeight}px`,
          position: 'relative',
        }}
      >
        <div style={{ height: totalHeight, position: 'relative' }}>
          {rows.map((row) => {
            const highlighted =
              jumpToOffset != null &&
              jumpToOffset >= row.offset &&
              jumpToOffset < row.offset + bytesPerRow;
            return (
              <div
                key={row.offset}
                style={{
                  position: 'absolute',
                  top: Math.floor(row.offset / bytesPerRow) * rowHeight,
                  left: 0,
                  right: 0,
                  display: 'grid',
                  gridTemplateColumns: '90px 1fr 180px',
                  gap: 16,
                  padding: '0 12px',
                  whiteSpace: 'pre',
                  background: highlighted ? 'var(--accent-weak)' : 'transparent',
                }}
              >
                <span style={{ color: 'var(--text-muted)' }}>{formatOffset(row.offset)}</span>
                <span>{row.hex}</span>
                <span style={{ color: 'var(--text-muted)' }}>{row.ascii}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
