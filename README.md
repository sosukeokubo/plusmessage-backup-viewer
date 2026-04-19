# PlusMessage Backup Viewer

＋メッセージ（PlusMessage、ドコモ/au/ソフトバンクのRCSアプリ）の `PlusMessage.backup` ファイルをブラウザ上だけで閲覧できるビューアー。

**ファイルはサーバーに送信されません。** すべての処理はブラウザ内で完結します。

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
- 重いバイト操作は Web Worker に委譲予定（Step 6 以降）

## プライバシー

- ログ、アナリティクス、エラー送信はすべて **Off**
- CSP で外部通信を制限（`public/_headers` で指定、Cloudflare Pages 配信時に有効）

## スコープ

[仕様と実装計画](../.claude/plans/plusmessage-backup-web-foamy-neumann.md)参照。
