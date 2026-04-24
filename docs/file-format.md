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
| 0x0006 | THREAD     | 単一スレッド             | ヘッダのみ |
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
  +4      u8  flag              — 0x00 または 0x01 を観測
  +5      u16 padding           — 常に 0x0000
  +7      u32 sizeField         — 圧縮前サイズと思われるが未確定
  +11     ...  body              — ここから後が本番。未解析
```

body 内部には次が混在する（完全な構造は未判明）:

- JPEG 画像（`FF D8 FF … FF D9` で検出可能。現パーサで抽出済み）
- zlib 圧縮された PNG（`0x78` + チェックサム通過で検出。現パーサで抽出済み）
- UUID や URL、MIME type 等の長さ接頭辞付き ASCII メタ
- バイナリの長さ・タイムスタンプ・フラグフィールド群（未分解）
- **本文テキスト** — JP/EN が混在。**どこにどう格納されているかは未判明**

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
