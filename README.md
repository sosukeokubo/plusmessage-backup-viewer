# PlusMessage Backup Viewer

＋メッセージ（PlusMessage、ドコモ/au/ソフトバンクのRCSアプリ）の `PlusMessage.backup` ファイルをブラウザ上だけで閲覧できるビューアー。

**ファイルはサーバーに送信されません。** すべての処理はブラウザ内で完結します。

> ドキュメントとテストに出てくる電話番号・氏名・メッセージ本文・UUID は
> **すべて架空の値**です。解析対象は実在する個人のバックアップのため、
> 実データは一切コミットしていません。詳細は [CLAUDE.md](./CLAUDE.md)。

## 使い方（開発）

```bash
git clone https://github.com/sosukeokubo/plusmessage-backup-viewer.git
cd plusmessage-backup-viewer
pnpm install
pnpm dev           # http://localhost:5173
pnpm test          # Vitest
pnpm build         # dist/ へビルド
pnpm preview       # dist/ を本番同等で serve
```

**バックアップファイルは同梱していません。** 画面で会話を表示するには、自分の
`PlusMessage.backup` が必要です。解析に使ったファイルは実在する個人のデータな
ので、リポジトリには入れていません。

`pnpm test` は実ファイルなしで通ります。テストは架空の値から組み立てたバイト列
に対して走るためです。実ファイルを引数に取るのは `scripts/` 以下の検証
スクリプトだけです。

## 構成

- React + Vite + TypeScript
- パーサは `src/parser/`（DOM非依存、Vitestで直接テスト可能）
- 重いバイト操作は Web Worker（`src/worker/parser.worker.ts`）に委譲、メイン側は summary のみ保持

## プライバシー

- ログ、アナリティクス、エラー送信はすべて **Off**
- CSP で外部通信を制限（`public/_headers` で指定、Cloudflare Workers 配信時に有効）

## デプロイ（Cloudflare Workers）

`wrangler.jsonc` が `dist/` を静的アセットとして配信する。`public/_headers` は
`vite build` が `dist/` 直下へコピーし、Workers Static Assets がそれをそのまま
解釈するので、デプロイするだけで CSP / COOP / Referrer-Policy が有効になる。

```bash
pnpm build
# ローカル確認
pnpm preview
# デプロイ（初回は npx wrangler login が必要）
npx wrangler deploy
```

Worker スクリプトは書いていないので、`wrangler.jsonc` に `main` は無い。
`dist/_headers` が欠けるとヘッダは**エラーを出さずに消える**ため、
デプロイ後は下の `curl -I` で必ず確認する。

Cloudflare Pages でも動くが（`npx wrangler pages deploy dist/`）、Cloudflare は
新規プロジェクトを Workers に寄せており、`_headers` の扱いは両者で同じなので
Workers を既定にしている。

### プライバシー検証

- DevTools → Network タブで、静的アセット以外の通信が発生しないことを確認
- `curl -I <公開URL>` で `Content-Security-Policy` / `Cross-Origin-Opener-Policy` が配信されていることを確認

## 解析ドキュメント

このアプリはバックアップ形式のリバースエンジニアリングの上に成り立っている。
公式仕様は非公開で、すべての知見は 1 個の実ファイルを手作業で読んで得たもの。

- [docs/](./docs/) — 解析ノート一式
- [docs/file-format.md](./docs/file-format.md) — ファイル全体の構造
- [docs/section-0x0001-inbox.md](./docs/section-0x0001-inbox.md) — 本文とメディアが
  入っているセクションの詳細
- [docs/open-questions.md](./docs/open-questions.md) — **未解決の疑問**。
  それぞれに「検証方法」を書いてある

## 協力してほしいこと

**解析の律速は、手元にバックアップが 1 個しかないことです。**

現在の知見はすべて **ドコモ回線・iOS 版・2023〜2026 年のデータ 1 ファイル**
から得たもので、次のような問いは「別の条件で取ったファイルと突き合わせる」
以外に検証しようがありません。

| 未解決                               | 何が分かれば解けるか                                |
| ------------------------------------ | --------------------------------------------------- |
| プリアンブル 126 バイトの中身        | アプリのバージョンが違うファイルとの差分            |
| メディアの送受信方向を示すフィールド | 送信した画像が確実に含まれるファイル                |
| 連絡先レコード末尾 20 バイト         | お気に入り・ブロックを設定した連絡先を含むファイル  |
| 電話番号の表記ゆれ                   | 国内表記（`090-…`）で保存された連絡先を含むファイル |

**Android 版**が書き出したファイル、au / ソフトバンク回線のファイル、
グループトークや音声・動画・位置情報の添付を含むファイルは、
**まだ 1 件も見ていません。** 形式が同じである保証すらない状態です。

### バックアップファイルは送らないでください

**これは他のプロジェクトと決定的に違う点です。** `PlusMessage.backup` は
そのままあなたの実際のメッセージです。こちらが必要としているのは
**構造の観測値だけ**で、中身ではありません。ファイルを受け取ることは、
他人の私信をこのプロジェクトに取り込むことになります。

Issue や PR に次のものを貼らないでください。

- 実在する電話番号・氏名
- 実際のメッセージ本文。断片でも、検索に使ったフレーズでも
- UUID・端末 ID・資材 URL のリソース ID
- **hexdump のバイト列**。16 進数をデコードすれば本文が読めます
- アプリやこのビューアーの実画面のスクリーンショット

### 代わりに送ってほしいもの

手元でスクリプトを走らせて、**出てきた数値と構造だけ**を報告してください。
ファイルはあなたの端末から出ません。

```bash
pnpm install
# PlusMessage.backup を作業ディレクトリ直下に置いてから
pnpm tsx scripts/analyze.ts ./PlusMessage.backup
pnpm tsx scripts/scan-settings.ts ./PlusMessage.backup
```

報告してほしいのは次のようなものです。

- セクション構成（type / offset / length）と、パーサが最後まで辿り切れたか
- `bytes consumed: N/N (exact)` が成立するか、途中で崩れるか
- 件数の内訳（ピア数・本文の方向 × 経路・メディア件数）
- 宣言値とデコード結果が食い違ったバケットの有無
- 回線（ドコモ / au / ソフトバンク）、OS、アプリのバージョン

パーサが途中で落ちる場合は、**落ちた絶対オフセットとその手前の TLV ヘッダの
値**（type / field1 / contentLen の 3 つの数値）だけで十分です。周辺の
バイト列は不要です。

### コードの PR

歓迎します。[CLAUDE.md](./CLAUDE.md) に、このリポジトリで守っている
データの扱いと解析の姿勢（観測と仮説を分けて書く、オフセットは絶対値で書く、
過去の推定を鵜呑みにしない）をまとめてあります。

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm format:check
```

新しい知見は `docs/findings-YYYY-MM-DD.md` に、使ったスクリプト・観察された
出力・そこから何を結論したかをセットで残してください。仮説を仮説として
書いてある PR は歓迎です。断定して書かれている方が困ります。

## ライセンス

[0BSD](./LICENSE)。制限なし、帰属表示も不要です。
