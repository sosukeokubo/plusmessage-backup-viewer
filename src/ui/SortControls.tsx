export type ThreadSort = 'file-order' | 'message-volume' | 'attachment-count';

const OPTIONS: { value: ThreadSort; label: string }[] = [
  { value: 'file-order', label: '元の順序' },
  { value: 'message-volume', label: 'やり取りが多い順' },
  { value: 'attachment-count', label: '写真が多い順' },
];

interface Props {
  value: ThreadSort;
  onChange: (v: ThreadSort) => void;
}

export function SortControls({ value, onChange }: Props) {
  return (
    <label
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 12,
        color: 'var(--text-muted)',
      }}
    >
      並び替え:
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as ThreadSort)}
        style={{
          fontSize: 12,
          padding: '2px 6px',
          border: '1px solid var(--border)',
          borderRadius: 4,
          background: 'var(--bg)',
          color: 'var(--text)',
          fontFamily: 'inherit',
        }}
      >
        {OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}

