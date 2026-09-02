# 2026-09-02 検証ログ: スレッドと相手の紐付け (Q4)

[open-questions.md](./open-questions.md) の Q4「44 スレッドの相手が全部
undefined」を解いた記録。あわせて Q2 / Q4-bis / Q9 も決着した。

対象ファイル: `PlusMessage.backup` (65,159,882 B)

## 1. Q4 に書いてあった検証方法は空振りする

当初の計画は「各 thread body から `findAllPeerPhones` で `+`電話番号を探す」
だった。44 スレッド全部に対して実行した結果：

| 探索対象 | ヒット |
|---|---|
| 長さ接頭辞つき `+`電話番号 | 0 |
| 生の `+81…` 文字列 | 0 |
| 国内表記 `090…` | 0 |
| `sip:` / `tel:` URI | 0 |

**thread body には相手を示すバイトが 1 つも無い。** CONTACTS (85 件) と
THREAD (44 件) の index 対応も存在しない。

## 2. 理由: THREAD は会話ではなくメディア 1 件

body 先頭をデコードすると構造が割れる：

```
[u32 nameLen][name][u32 pathLen][path][u32 mimeLen][mime][0x0007][sizes…][画像バイト列]
```

| tid | name | mime | path |
|---|---|---|---|
| 1 | `3f2a91c7-0b4d-4e18-9a52-6c7d8e0f1a2b` | image/png | `0,https://a-wss.kw.ncs.spmode.ne.jp/…` |
| 8 | `7c8d9e0f-1a2b-4c3d-8e5f-6a7b8c9d0e1f` | image/gif | `0,https://sticker-a.w01.rcs.kddi.ne.jp/…` |
| 9 | `IMG_2895.jpg` | image/jpeg | `0,app://photos-kit/F0E1D2C3-…/L0/001/RESIZE` |
| 17 | `IMG_20230330_174646_1681607355610.jpg` | image/jpeg | `0,/var/mobile/Containers/Data/Application/…` |

**1 レコード = 1 ファイル**。会話ではないので相手情報を持たないのは当然で、
Q2「会話 1〜61 とは何か」の答えでもある。61 = メディア 44 + SMS バケット 17
であって、会話が 61 本あったわけではない。

ついでに header の 2 フィールドも確定した（Q9）：

- `flag` = 0 が端末ローカル（iOS フォトライブラリ / アプリ sandbox）、
  1 がキャリアの資材サーバから DL したもの
- `sizeField` = デコード後のバイト数。生 JPEG は格納長そのもの、
  zlib 包みの PNG/GIF は展開後サイズ

## 3. 正しい紐付けキーはファイル名

メディア名は SETTINGS 側の配信メッセージにも現れる。DL 資材は RCS の
`<file-name>` 記述子として、送信画像は取得元パスの末尾として：

```
@0x5b03  <file-info type="file"><file-size>202200</file-size>
         <file-name>3f2a91c7-0b4d-4e18-9a52-6c7d8e0f1a2b</file-name>…
@0x48022 …tel:+819012340001…0,/var/mobile/…/IMG_20230330_174646_1681607355610.jpg
```

その出現位置に対して「直前の peer 識別子」を取ると **44/44 が一意に解決**する
（複数の peer に割れたものはゼロ）。

| peer | メディア数 |
|---|---|
| `+819012340001` | 43 |
| `docomoPlusMessagePoint@maap.plus-msg.com` | 1 |

## 4. peer 識別子は電話番号だけではない

peer は contact blob を閉じる RS 区切りトークン (`0x1e <id> 0x1e`) として
格納されている。SETTINGS 全域で 20 種類：

```
+819012340004 … +819012340002             (電話番号 18)
docomoPlusMessagePoint@maap.plus-msg.com  ×5
operator@kw.ncs.spmode.ne.jp              ×12
```

旧 `findAllPeerPhones`（u32 長さ + `+`数字のみ）はサービスアドレス 2 件を
取り逃していた。全員が「直前の marker」で相手を決める設計なので、marker が
欠けるとバケット 1 個分がまるごと誤帰属する。

**実害があった**: `operator@kw.ncs.spmode.ne.jp` 宛の 12 通（ドコモからの
フィッシング注意喚起など）が `+819012340002` の会話として表示されていた。
`findAllPeerIds` に置き換えて解消。バケットは 17 → 18 になった。

## 5. 名前は CONTACTS ではなく SETTINGS にある (Q4-bis)

CONTACTS 85 件は名前フィールドが全件空で、**本当にデータが入っていない**
（`PHONE_LIKE` 正規表現の弾きすぎではない）。一方 SETTINGS のメッセージに
埋まった contact blob には入っている：

```
GS 0 GS "" GS <表示名> GS tel GS <電話番号> GS
```

```
+819012340001  "花子"×121  ""×21  "hanako"×4
+819012340003  "山田太郎"×1
```

同じ blob がメッセージごとに繰り返され、名前が空のこともあるので
**最頻の非空スペリング**を採用する。実データで名前が付くのは 2 件だけ。

## 6. 実装

| ファイル | 内容 |
|---|---|
| [src/parser/inbox.ts](../src/parser/inbox.ts) | `findAllPeerIds` / `extractPeerNames` を追加。`parseInbox` を marker ベースに |
| [src/parser/media.ts](../src/parser/media.ts) | `readMediaHeader` / `assignThreadPeers`（新規） |
| [src/parser/sections.ts](../src/parser/sections.ts) | `parseThread` でメディアヘッダを保持。全セクション読了後に post-pass で結合 |
| [src/util/contactResolver.ts](../src/util/contactResolver.ts) | `normalizePeerId` を追加。表示名は CONTACTS → SETTINGS → 電話番号の順 |
| [src/util/inboxIndex.ts](../src/util/inboxIndex.ts) | `composeThreadList` を peer 単位マージに |

`peerPhone` は値がサービスアドレスも取るようになったため **`peerId` に
リネーム**した（`InboxBucket` / `InboxMessage` / `Thread` / `ThreadSummary`）。

紐付けはセクションの出現順に依存しないよう、`parseBackup` のループ内ではなく
末尾の post-pass に置いた。

## 7. 検証結果

### 7.1 実ファイル

```
threads=44  peer解決済み=44  buckets=18  names=2
サイドバー行数: 61 → 19
```

```
[ 0] named   花子                                        msgs= 37 photos= 43
[ 1] service docomoPlusMessagePoint@maap.plus-msg.com    msgs=  0 photos=  1
[ 2] phone   +819012340004                               msgs=  1 photos=  0
…
[18] service operator@kw.ncs.spmode.ne.jp                msgs= 12 photos=  0
```

### 7.2 パース時間

同一プロセスで 3 回連続パースした比較：

| | 実行時間 |
|---|---|
| 修正前 | 1239 / 877 / 883 ms |
| 修正後 | 1111 / 891 / 873 ms |

**有意差なし**。増えたのは SETTINGS (115KB) の走査と、メディア名 44 件の
逆引き（実測 約 29ms/回）だけ。

### 7.3 ブラウザでの確認 (playwright-cli)

`pnpm dev` に実ファイルを投入：

- ヘッダが「会話 19 件」
- 「花子」の行に `メッセージ37 · 写真43 · 断片1` が出る
  （43 件は 44 レコードから docomo 公式アカウント宛の 1 件を除いた数）
- 会話を開いて 43 タイル全部を lazy-load させ、Blob を `fetch` して
  MIME を直接確認: `image/png` 17 / `image/gif` 12 / `image/jpeg` 14 = 43。
  デコードサイズはスタンプが 500×500
- `operator@kw.ncs.spmode.ne.jp` の会話にドコモからの注意喚起 12 通が入る
- コンソールエラー 0 件

実メッセージが写るためスクリーンショットはリポジトリに残していない。

## 8. テスト

`pnpm test` 75 → **102 件**パス。追加分：

- `test/media.test.ts`（新規 8 件）— ヘッダ復号、非メディア body の拒否、
  nearest-preceding の帰属、複数 peer に割れた場合の未割当
- `test/inbox.test.ts` — `findAllPeerIds` / `extractPeerNames`、および
  サービスアドレスのバケットが手前の電話番号から分離される回帰テスト
- `test/inboxIndex.test.ts`（新規 7 件）— peer 単位マージ、単一ファイル時の
  メタデータ保持、peer 未解決レコードの単独行、inbox のみのバケット追加
- `test/contactResolver.test.ts` — `normalizePeerId`、SETTINGS 名の採用、
  サービスアドレスの verbatim 表示

## 9. 使用スクリプト

```
pnpm tsx scripts/scan-thread-peers.ts ./PlusMessage.backup
```

Section 1 の「thread body に電話番号は無い」チェックも、空振りすること自体が
結論なのでスクリプトに残してある。

## 10. 残った気付き

- `formatPhone` は 10/11 桁しか整形しないため、`+819012340004` (12 桁) が
  そのまま表示される。マージで電話番号の行が目立つようになったので、
  `+81` → `0` の正規化を入れる価値が出た
- SETTINGS には本文メッセージ 66 件のほかに、メディア配信のレコードが
  少なくとも 121 件ある（`花子` の blob 出現数）。そちらを解析すれば
  画像にもタイムスタンプと送受信方向が付き、本文と時系列で混ぜられる
