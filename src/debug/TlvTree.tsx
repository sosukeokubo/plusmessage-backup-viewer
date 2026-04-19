import { useMemo } from 'react';
import type { BackupSummary, RawChunkSummary } from '../parser/types';
import { SECTION_NAMES } from '../parser/constants';

interface Props {
  backup: BackupSummary;
  onJumpTo?: ((offset: number) => void) | undefined;
  /** When set, the section whose byte range contains this offset is highlighted. */
  highlightOffset?: number | undefined;
}

function formatHex(n: number, width: number): string {
  return `0x${n.toString(16).toUpperCase().padStart(width, '0')}`;
}

function labelFor(type: number): string {
  return SECTION_NAMES[type] ?? 'UNKNOWN';
}

function SectionRow({
  chunk,
  onJumpTo,
  highlighted,
  isUnknown,
}: {
  chunk: RawChunkSummary;
  onJumpTo?: ((offset: number) => void) | undefined;
  highlighted: boolean;
  isUnknown: boolean;
}) {
  const name = labelFor(chunk.type);
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '90px 120px 1fr 110px',
        gap: 8,
        padding: '4px 8px',
        borderBottom: '1px dashed var(--border)',
        borderLeft: highlighted ? '3px solid var(--accent)' : '3px solid transparent',
        background: highlighted ? 'var(--accent-weak)' : 'transparent',
        fontFamily: 'var(--mono)',
        fontSize: 12,
        alignItems: 'center',
      }}
    >
      <span style={{ color: isUnknown ? 'var(--danger)' : 'var(--accent)' }}>
        {formatHex(chunk.type, 4)}
      </span>
      <span style={{ color: isUnknown ? 'var(--danger)' : 'var(--text)' }}>{name}</span>
      <span style={{ color: 'var(--text-muted)' }}>
        offset {formatHex(chunk.offset, 8)} · {chunk.length.toLocaleString()} B
      </span>
      {onJumpTo && (
        <button
          onClick={() => onJumpTo(chunk.offset)}
          style={{ fontSize: 11, padding: '2px 6px' }}
        >
          hex へ
        </button>
      )}
    </div>
  );
}

export function TlvTree({ backup, onJumpTo, highlightOffset }: Props) {
  const stats = useMemo(() => {
    const counts = new Map<number, number>();
    for (const s of backup.sections) {
      counts.set(s.type, (counts.get(s.type) ?? 0) + 1);
    }
    const owner = backup.meta?.items.find((it) => it.key === 'backup_owner')?.valueUtf8;
    return {
      total: backup.sections.length,
      counts,
      threads: backup.threads.length,
      contacts: backup.contacts.length,
      metaItems: backup.meta?.items.length ?? 0,
      unknown: backup.unknownSections.length,
      owner,
    };
  }, [backup]);

  const consumedPct = ((backup.bytesConsumed / backup.fileSize) * 100).toFixed(2);

  const highlightedOffset = useMemo(() => {
    if (highlightOffset == null) return null;
    // Pick the section whose [offset, offset+length) contains the cursor.
    for (const s of backup.sections) {
      if (highlightOffset >= s.offset && highlightOffset < s.offset + s.length) {
        return s.offset;
      }
    }
    return null;
  }, [backup.sections, highlightOffset]);

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
        {stats.owner && (
          <span>
            Backup owner: <strong>{stats.owner}</strong>
          </span>
        )}
        <span>
          <strong>{stats.total}</strong> セクション
        </span>
        <span>
          threads: <strong>{stats.threads}</strong>
        </span>
        <span>
          contacts: <strong>{stats.contacts}</strong>
        </span>
        <span>
          meta items: <strong>{stats.metaItems}</strong>
        </span>
        <span style={{ color: stats.unknown > 0 ? 'var(--danger)' : 'var(--text-muted)' }}>
          unknown: <strong>{stats.unknown}</strong>
        </span>
        <span>
          consumed: <strong>{backup.bytesConsumed.toLocaleString()}</strong> /{' '}
          {backup.fileSize.toLocaleString()} B ({consumedPct}%)
        </span>
      </div>
      <div style={{ overflow: 'auto', flex: 1 }}>
        {backup.sections.map((s) => (
          <SectionRow
            key={`${s.offset}`}
            chunk={s}
            onJumpTo={onJumpTo}
            highlighted={s.offset === highlightedOffset}
            isUnknown={!(s.type in SECTION_NAMES)}
          />
        ))}
      </div>
    </div>
  );
}
