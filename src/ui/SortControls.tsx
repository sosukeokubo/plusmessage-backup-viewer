import { SORT_LABELS, SORT_OPTIONS, type ThreadSort } from '../util/threadSort';

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
        {SORT_OPTIONS.map((opt) => (
          <option key={opt} value={opt}>
            {SORT_LABELS[opt]}
          </option>
        ))}
      </select>
    </label>
  );
}
