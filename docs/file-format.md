# ファイル全体の構造

`wclBackup` マジックで囲われた TLV セクションの連なり。現時点で判明している
層を上から下に記す。

## 1. プリアンブル（0x00 ～ 0x7D, 126 bytes）

```
offset 0x00: 77 63 6c 42 61 63 6b 75 70   "wclBackup" (9 bytes)
offset 0x09: 未解析 (117 bytes)            バージョン、作成日時、
                                           デバイス情報等と思われる
```

- 現在のパーサは `PREAMBLE_SIZE = 0x7e` でまとめて読み飛ばしている
  （[src/parser/constants.ts](../src/parser/constants.ts:6)）
- 内容を解析すれば「バックアップ作成時のアプリバージョン」「対象 SIM」等が
  取れる可能性がある — 未着手

## 2. TLV セクション列（0x7E ～ EOF-9）

各セクションは共通の 10 バイトヘッダを持つ:

```
offset  size  内容
+0      u16   section type (LE)
+2      u32   field1       (LE) — ほぼ常に 4。意味未確定
+6      u32   contentLen   (LE) — ヘッダ以降のペイロード長
+10     ...   content      (contentLen バイト)
```

この TLV ヘッダは [`src/parser/tlv.ts`](../src/parser/tlv.ts) の `readTlv` で
復号される。同じ形が内部アイテム（KV、CONTACT、THREAD）にも再帰的に使われる。

### 既知のセクションタイプ

| type   | 名前       | 用途                    | パース状況 |
|--------|------------|-------------------------|------------|
| 0x0001 | SETTINGS   | **実体は SMS 受信箱**   | 部分的（後述） |
| 0x0005 | MESSAGES   | スレッドコンテナ         | ✅ |
| 0x0006 | THREAD     | メディア 1 件（会話ではない） | ✅ |
| 0x0008 | END        | セクション終端センチネル | ✅ |
| 0x000b | META       | KV ペアのバックアップ設定 | ✅ |
| 0x000d | CONTACTS   | 連絡先帳                | ✅ |

### 既知の内部アイテムタイプ

| type   | 名前       | 親セクション | パース状況 |
|--------|------------|--------------|------------|
| 0x000c | KEY_VALUE  | META         | ✅ |
| 0x000e | CONTACT    | CONTACTS     | ✅ |

## 3. 末尾マジック（EOF-9 ～ EOF）

- 同じ `wclBackup` 9 バイトが末尾センチネルとして置かれる
- これにより「ファイルが途中で切れていない」ことを検証できる

## セクション別の詳細

### META (0x000b)

```
content:
  +0      u32 count
  +4..    count × TLV<0x000c>
```

KEY_VALUE レコードは `keyLen:u32 | key:utf8 | valueLen:u32 | value:utf8`。
観測された key の例:

- `backup_owner` → 持ち主の電話番号（例 `+819012340000`）
- 他にもバックアップ作成日時と思われるキーあり

コード: [src/parser/sections.ts](../src/parser/sections.ts:191) の `parseMeta`

### CONTACTS (0x000d)

```
content:
  +0      u32 count
  +4..    count × TLV<0x000e>
```

CONTACT レコードは `phoneLen:u32 | phone:ascii | blobLen:u32 | blob | tail:20 bytes`。
blob は GS (0x1d) と RS (0x1e) で区切られた ASCII:

```
0  GS GS GS  tel  GS  +81xxxxxxxxxx  GS  "山田 太郎"  RS  +81xxxxxxxxxx  RS
```

- 先頭の `0` は何かのプロバイダ ID ？
- `tel` は channel tag
- 表示名フィールドが後続する場合がある
- tail 20 バイトは未解析（8 バイト目に 0x01 がよく出る）

コード: [src/parser/sections.ts](../src/parser/sections.ts:113) の `decodeContact`

### MESSAGES (0x0005) / THREAD (0x0006)

```
MESSAGES.content:
  +0      u32 threadCount
  +4..    threadCount × TLV<0x0006>

THREAD.content:
  +0      u32 threadId          — 1 起点の連番
  +4      u8  flag              — 0=端末ローカルのファイル / 1=サーバから DL
  +5      u16 padding           — 常に 0x0000
  +7      u32 sizeField         — デコード後のバイト数
                                  （生 JPEG は格納長そのもの、zlib 包みは展開後）
  +11     ...  body

THREAD.body:
  +0      u32 nameLen / name    — DL 資材は UUID、送信画像は元ファイル名
  ...     u32 pathLen / path    — `0,` 接頭辞つきの取得元
  ...     u32 mimeLen / mime    — image/jpeg | image/png | image/gif
  ...     u16 0x0007            — 用途不明のタグ。全 44 件で同値
  ...     u32 × 2〜3            — サイズ群（JPEG は 2 個、zlib 包みは 3 個）
  ...     ...                   — 画像バイト列（生 JPEG または zlib stream）
```

**THREAD は会話ではなくメディア 1 件**。名前のとおりのスレッドではなく、
写真・スタンプ 1 ファイル分の格納単位で、相手を示す情報を一切持たない
（実ファイル 44 件すべてで電話番号・SIP URI ともに 0 バイト）。

相手は `name` を SETTINGS 側で逆引きして解決する。詳細は
[findings-2026-09-02-peers.md](./findings-2026-09-02-peers.md)。

観測された `path` の 3 系統:

| 系統 | 例 | flag |
|---|---|---|
| キャリアの資材サーバ | `0,https://a-wss.kw.ncs.spmode.ne.jp/wss-core//rest/resource/…` | 1 |
| iOS フォトライブラリ | `0,app://photos-kit/<uuid>/L0/001/RESIZE` | 0 |
| アプリのサンドボックス | `0,/var/mobile/Containers/Data/Application/…/tmp/IMG_….jpg` | 0 |

コード: [src/parser/sections.ts](../src/parser/sections.ts:220) の `parseThread`

### SETTINGS (0x0001)

歴史的な誤称。実体は SMS 受信箱ストア。詳しくは
[section-0x0001-inbox.md](./section-0x0001-inbox.md) 参照。

## 用語集

- **TLV** — Type-Length-Value。形式共通のバイナリレコード
- **GS / RS** — ASCII control: Group Separator (0x1d) / Record Separator (0x1e)
- **anchor** — ファイル内を走査して特定パターンを探すための既知バイト列
- **peer** — 自分以外の相手（スレッドの相手）
- **bucket** — 同一の相手に関連付けられたレコード群のまとまり
