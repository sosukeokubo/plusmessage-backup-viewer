# PlusMessage Backup Viewer

＋メッセージ（PlusMessage、ドコモ/au/ソフトバンクのRCSアプリ）の `PlusMessage.backup` ファイルをブラウザ上だけで閲覧できるビューアー。

**ファイルはサーバーに送信されません。** すべての処理はブラウザ内で完結します。

> ドキュメントとテストに出てくる電話番号・氏名・メッセージ本文・UUID は
> **すべて架空の値**です。解析対象は実在する個人のバックアップのため、
> 実データは一切コミットしていません。詳細は [CLAUDE.md](./CLAUDE.md)。

## 使い方（開発）

```bash
pnpm install
pnpm dev           # http://localhost:5173
pnpm test          # Vitest
pnpm build         # dist/ へビルド
pnpm preview       # dist/ を本番同等で serve
```

## 構成

- React + Vite + TypeScript
- パーサは `src/parser/`（DOM非依存、Vitestで直接テスト可能）
- 重いバイト操作は Web Worker（`src/worker/parser.worker.ts`）に委譲、メイン側は summary のみ保持

## プライバシー

- ログ、アナリティクス、エラー送信はすべて **Off**
- CSP で外部通信を制限（`public/_headers` で指定、Cloudflare Pages 配信時に有効）

## デプロイ（Cloudflare Pages）

`public/_headers` が `dist/` にそのまま配置されるので、Cloudflare Pages にデプロイするだけで CSP / COOP / Referrer-Policy などのヘッダが有効になる。

```bash
pnpm build
# ローカル確認
pnpm preview
# デプロイ（wrangler をインストール済みの場合）
npx wrangler pages deploy dist/
```

### プライバシー検証

- DevTools → Network タブで、静的アセット以外の通信が発生しないことを確認
- `curl -I <公開URL>` で `Content-Security-Policy` / `Cross-Origin-Opener-Policy` が配信されていることを確認

## スコープ

[仕様と実装計画](../.claude/plans/plusmessage-backup-web-foamy-neumann.md)参照。
