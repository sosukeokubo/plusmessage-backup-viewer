import { useState } from 'react';

export function PrivacyBanner() {
  const [expanded, setExpanded] = useState(false);
  return (
    <section
      style={{
        border: '1px solid var(--border)',
        borderLeft: '4px solid var(--accent)',
        background: 'var(--bg-elev)',
        padding: 16,
        borderRadius: 'var(--radius)',
        maxWidth: 720,
      }}
    >
      <h2 style={{ margin: '0 0 8px', fontSize: 16 }}>
        このビューアーはバックアップファイルをサーバーに送信しません
      </h2>
      <p style={{ margin: '0 0 8px', color: 'var(--text-muted)' }}>
        すべての処理はお使いのブラウザ内で完結します。ファイルはアップロードされません。
      </p>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        style={{
          background: 'transparent',
          border: 'none',
          color: 'var(--accent)',
          padding: 0,
          font: 'inherit',
        }}
      >
        {expanded ? '閉じる' : '確認する方法を見る'}
      </button>
      {expanded && (
        <ol style={{ color: 'var(--text-muted)', marginTop: 8, paddingLeft: 20 }}>
          <li>このページでブラウザの開発者ツール（DevTools）を開く</li>
          <li>「ネットワーク」タブを選び、再読込してから何も通信が記録されないことを確認</li>
          <li>バックアップファイルを読み込み、その後も外部への送信が発生しないことを確認</li>
        </ol>
      )}
    </section>
  );
}
