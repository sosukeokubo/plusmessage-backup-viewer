# +メッセージバックアップ解析ドキュメント

`PlusMessage.backup` ファイルをリバースエンジニアリングして本文を復元するための
解析ノート。実ファイル（約 62MB、2020–2025 年のデータ）を手動で突き合わせて
得られた知見をまとめる。

## 目次

- [file-format.md](./file-format.md) — バックアップファイル全体の構造
  （プリアンブル、TLV セクション、エンドセンチネル）
- [section-0x0001-inbox.md](./section-0x0001-inbox.md) — 「SETTINGS」セクション
  (実体は SMS と +メッセージの送受信を統合した本文ストア) の詳細解析
- [text-restoration.md](./text-restoration.md) — 本文復元のために試した手法と、
  何が機能して何が機能しなかったかの記録
- [open-questions.md](./open-questions.md) — 未解決の疑問と、次に調べるべき
  箇所のチェックリスト
- [findings-2026-04-25.md](./findings-2026-04-25.md) — 実 62MB ファイルでの
  検証結果ログ（SMS 復元 17 バケット 61 通の確認、UI 配線の検証）
- [findings-2026-04-26.md](./findings-2026-04-26.md) — +メッセージ本文の
  格納場所を特定（SETTINGS 内に送信アンカー `06…04` で格納されていた）。
  parseInbox を 2 アンカー対応に改修し、`InboxBubble` を direction 別の
  左右レイアウトに変更してブラウザでも確認した

## 検証スクリプト

実ファイル `PlusMessage.backup` を作業ディレクトリ直下に置いた状態で：

- `pnpm tsx scripts/analyze.ts ./PlusMessage.backup` — パーサ全体の動作確認
- `pnpm tsx scripts/ui-probe.ts ./PlusMessage.backup` — UI 配線
  (sidebar + detail) のシミュレーション
- `pnpm tsx scripts/grep-bytes.ts ./PlusMessage.backup --utf8 "<phrase>"`
  — 任意の UTF-8 文字列 / 16 進バイト列をファイル全域から検索し、
  ヒット箇所をセクション情報付きで hexdump 表示
- `pnpm tsx scripts/scan-zlib.ts ./PlusMessage.backup` — 全 thread body の
  zlib stream を列挙し、attachment 既知範囲外を hexdump でプレビュー

## 前提知識

- +メッセージ (plus message) は NTT ドコモ / au / ソフトバンクが提供する
  RCS ベースのメッセージングサービス
- このバックアップは Android 版アプリが書き出す独自バイナリ形式
- 公式仕様は非公開。すべての知見は手作業での観察による推定
- ファイルは `wclBackup` という 9 バイトの ASCII マジックで始まり終わる

## 解析の姿勢

- **観測と仮説を区別する。** 「ファイル上で実際に観測した」事実と、
  「こう解釈している」という仮説は別々に記す。後から仮説を覆す必要がある時の
  ためのログとして機能する
- **オフセットは絶対で記す。** 相対オフセットはスライスを跨ぐと混乱する
- **既知の動作サンプルで裏打ちする。** 新しい仮説を採用する前に、実ファイルで
  複数箇所に当てはまることを確認する
