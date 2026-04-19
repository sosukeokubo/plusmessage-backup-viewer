export type ThreadSort = 'file-order' | 'body-size' | 'string-count';

const OPTIONS: { value: ThreadSort; label: string }[] = [
  { value: 'file-order', label: 'ファイル順' },
  { value: 'body-size', label: 'サイズ' },
  { value: 'string-count', label: '文字列数' },
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
      ソート:
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
