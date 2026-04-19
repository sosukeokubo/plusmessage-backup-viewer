import { useEffect, useState } from 'react';
import { applyTheme, readTheme, type ThemeChoice } from '../util/theme';

const OPTIONS: { value: ThemeChoice; label: string; title: string }[] = [
  { value: 'auto', label: '自動', title: 'OSの設定に従う' },
  { value: 'light', label: '明', title: 'ライトテーマ' },
  { value: 'dark', label: '暗', title: 'ダークテーマ' },
];

export function DarkModeToggle() {
  const [theme, setTheme] = useState<ThemeChoice>(() => readTheme());

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  return (
    <div
      role="radiogroup"
      aria-label="テーマ"
      style={{
        display: 'inline-flex',
        border: '1px solid var(--border)',
        borderRadius: 6,
        overflow: 'hidden',
        fontSize: 12,
      }}
    >
      {OPTIONS.map((opt, i) => {
        const active = theme === opt.value;
        const isLast = i === OPTIONS.length - 1;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={opt.title}
            onClick={() => setTheme(opt.value)}
            style={{
              padding: '4px 10px',
              border: 'none',
              background: active ? 'var(--accent-weak)' : 'var(--bg)',
              color: active ? 'var(--accent)' : 'var(--text)',
              borderRight: isLast ? 'none' : '1px solid var(--border)',
              fontFamily: 'inherit',
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
