import { useState, type ReactNode } from 'react';
import { FilePicker } from './FilePicker';

interface Props {
  onFile: (file: File, buffer: ArrayBuffer) => void;
}

export function WelcomeScreen({ onFile }: Props) {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-start',
        gap: 24,
        padding: '32px 16px',
      }}
    >
      <header style={{ textAlign: 'center', maxWidth: 640 }}>
        <h1 style={{ fontSize: 26, margin: '0 0 12px', letterSpacing: '-0.01em' }}>
          ＋メッセージ バックアップビューアー
        </h1>
        <p style={{ color: 'var(--text-muted)', margin: 0, lineHeight: 1.7 }}>
          ＋メッセージのトラブルで消えてしまった過去のやり取りを、バックアップファイルから
          読み出して一覧できるツールです。ファイルは送信されず、お使いのブラウザ内だけで処理されます。
        </p>
      </header>

      <div style={{ width: '100%', maxWidth: 640 }}>
        <FilePicker onFile={onFile} />
      </div>

      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 12,
          width: '100%',
          maxWidth: 960,
        }}
      >
        <PrivacyCard />
        <HonestyCard />
        <HowtoCard />
      </section>
    </div>
  );
}

function Card({
  icon,
  title,
  children,
}: {
  icon: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <article
      style={{
        border: '1px solid var(--border)',
        background: 'var(--bg-elev)',
        borderRadius: 'var(--radius)',
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <h2 style={{ fontSize: 14, margin: 0 }}>
        <span aria-hidden="true" style={{ marginRight: 6 }}>
          {icon}
        </span>
        {title}
      </h2>
      <div style={{ color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.6 }}>{children}</div>
    </article>
  );
}

function PrivacyCard() {
  const [expanded, setExpanded] = useState(false);
  return (
    <Card icon="🔒" title="ファイルは送信されません">
      <p style={{ margin: '0 0 8px' }}>
        読み込みはすべてお使いのブラウザ内で行われます。インターネット越しにファイルが
        アップロードされることはありません。
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
          cursor: 'pointer',
        }}
      >
        {expanded ? '閉じる' : '実際に送信されないか確認する ▾'}
      </button>
      {expanded && (
        <ol style={{ margin: '8px 0 0', paddingLeft: 20, fontSize: 12 }}>
          <li>このページでブラウザの開発者ツール（DevTools）を開く</li>
          <li>「ネットワーク」タブで、通信が記録されないことを確認</li>
          <li>バックアップファイルを読み込んだ後も通信が発生しないことを確認</li>
        </ol>
      )}
    </Card>
  );
}

function HonestyCard() {
  return (
    <Card icon="💾" title="復元できる範囲について">
      <p style={{ margin: 0 }}>
        このツールはバックアップの仕様を完全には解読していません。
        取り出せるのは、<strong style={{ color: 'var(--text)' }}>写真（JPEG/PNG）</strong> と、
        本文の断片として残っている <strong style={{ color: 'var(--text)' }}>テキスト</strong>{' '}
        だけです。日時・送受信の区別・文脈は復元できません。
      </p>
    </Card>
  );
}

function HowtoCard() {
  const [expanded, setExpanded] = useState(false);
  return (
    <Card icon="📂" title="バックアップファイルとは">
      <p style={{ margin: '0 0 8px' }}>
        ＋メッセージアプリの「設定 → バックアップ・復元」から作成できる{' '}
        <code style={{ fontFamily: 'var(--mono)' }}>PlusMessage.backup</code>{' '}
        ファイルです。
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
          cursor: 'pointer',
        }}
      >
        {expanded ? '閉じる' : '取得手順を詳しく見る ▾'}
      </button>
      {expanded && (
        <ol style={{ margin: '8px 0 0', paddingLeft: 20, fontSize: 12 }}>
          <li>＋メッセージアプリを開く</li>
          <li>メニュー → 設定 → バックアップ・復元</li>
          <li>バックアップを作成し、保存場所を確認</li>
          <li>その <code style={{ fontFamily: 'var(--mono)' }}>.backup</code> ファイルをこのページにドラッグ</li>
        </ol>
      )}
    </Card>
  );
}
