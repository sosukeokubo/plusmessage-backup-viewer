# セクション 0x0001「SETTINGS」= メッセージストア本体

## 結論

歴史的に「SETTINGS」と名付けられているが、実体は **SMS と +メッセージを統合した
メッセージストア**である。しかも不透明なブロブではなく、
**ファイル全体と同じ 10 バイト TLV が入れ子になった構造体**で、
`u32 の件数` から末尾まで誤差ゼロで辿り切れる。

構造の解読経緯と実測値は
[findings-2026-09-03-settings.md](./findings-2026-09-03-settings.md) にある。

## 構造

```
SETTINGS content
├ u32 peerCount                          実ファイルでは 20
└ TLV(0x0002) × peerCount                ピア バケット（ピア ID 昇順）
   ├ header (TLV の field1 バイト)
   └ TLV(0x0003) × n → TLV(0x0004)       会話レコードと終端
```

TLV ヘッダは `u16 type` + `u32 field1` + `u32 contentLen`
（[tlv.ts](../src/parser/tlv.ts) と共通）。

### ピア バケット (0x0002)

TLV の `field1` は**ヘッダ長**で、値は **`44 + ピア ID のバイト長`**。
13 桁の電話番号なら 57 (= 0x39)、`operator@kw.ncs.spmode.ne.jp` なら 72、
40 文字の docomo アドレスなら 84。以前「常に 0x39」と記録していたのは
20 件中 18 件が 13 桁の電話番号だったための誤り。

```
+0   u32   後続する 0x0003 レコード数
+4   u32   未解読
+8   u32   うちメディア配信の件数
+12  20 B  未解読
+32  u32   ピア ID のバイト長
+36  <ピア ID>                            "+81…" または service@domain
+..  8 B   未解読
```

### 会話レコード (0x0003)

前段は本文・メディアで共通:

```
+0   u16   variant                        0 = 本文, 4 = メディア配信, 8 = サービス定義
+2   u16   0x0003
+4   u32   バケット内の連番（降順に並ぶ）
+8   u32   contact blob 長
+12  <contact blob>                       GS 区切り。末尾に RS で囲んだピア ID
+..  u32   2 個目の contact blob 長（0 のことが多い）
+..  <contact blob>                       1 個目と同一内容
+..  u32 × 5
+..  i64   タイムスタンプ (Unix ms)
```

contact blob の形は Contact セクションと同じ:

```
0 GS GS <表示名> GS tel GS <番号> GS GS tel:<番号> GS <番号> GS GS GS GS RS <ピア ID> RS
```

`tel` タグの直前が表示名。CONTACTS (0x000d) 側は実ファイルでは 85 件すべて
名前が空なので、**名前が残っているのはここだけ**。

#### variant = 0 — 本文

`u32 × 5` のうち **index 0 が方向、index 3 が経路**。

| index 0 | index 3 | MIME | 実ファイル件数 |
|---|---|---|---|
| 7 = 受信 | 5 = SMS | `text/plain;charset=utf-8` | 62 |
| 7 = 受信 | 4 = +メッセージ | `text/plain` | 45 |
| 6 = 送信 | 4 = +メッセージ | `text/plain` | 5 |

後段:

```
[i64 送信時刻][str 本文][str MIME][str メッセージ ID (32 文字)][str SIP メタデータ]
[u32][i64 保存時刻] …
```

文字列はすべて `[u32 LE 長さ][UTF-8 バイト列]`。

**方向は SIP からは復元できない。** 実ファイルの SIP From/To は全件
`<sip:anonymous@anonymous.invalid>`、フラグも `|1|1|0|` で一定。
上記 index 0 を読むのが正しい。

#### variant = 4 — メディア配信

```
[i64 送信時刻][u32 × 2][i64 資材の有効期限][u32 × 2]
[str 取得元パス][str カテゴリ][u32]
[str サムネの MIME][str 配信 ID][str RCS <file> XML]
[u32 × 2][i64 保存時刻]
```

- **取得元パス**: `0,` 接頭辞つき。`0,https://a-wss…`（キャリア資材サーバ）、
  `0,app://photos-kit/…` / `0,/var/mobile/…`（端末ローカル）
- **カテゴリ**: `image/png|basic-sticker`、`image/jpeg`、`image/png|chatbot`
- **サムネの MIME**: 本体の型ではない。GIF スタンプでもここは `image/png`
- **XML**: `type="thumbnail"` と `type="file"` の 2 つの `<file-info>`。
  `<file-name>` は後者にしかなく、これが THREAD (0x0006) との結合キー

#### variant = 8 — サービス定義

docomo 公式アカウントのバケットに 1 件だけある。contact blob に `isbot true`
を含み、会話ではなくボットの定義と読める。デコードせず件数のみ数えている
（`SettingsPeer.unknownRecords`）。Q13。

## 実装

[src/parser/settings.ts](../src/parser/settings.ts) が上記をそのまま辿る。
[src/parser/inbox.ts](../src/parser/inbox.ts) はその結果を UI 向けの
`InboxBucket[]` に射影するだけの薄いアダプタ。

以前の実装はバケット枠を信用せず 20 バイトの「アンカー」をバイト列として
総当たり検索していた。方向と経路が独立した 2 軸であることに気づいておらず
**受信 +メッセージ 45 通を 1 通も拾えていなかった**。構造を辿れば探索は不要。

## 検証

```bash
pnpm tsx scripts/scan-settings.ts ./PlusMessage.backup
```

実ファイルでの結果: 20 ピア / 本文 112 通 (受信 SMS 62・受信 +メッセージ 45・
送信 +メッセージ 5) / メディア配信 44 件。バケットヘッダの宣言件数と
デコード結果は 20 バケットすべてで一致。

## 未解決

- 2 個目の contact blob を持つメディアレコードが 24 件、持たないものが 20 件
  あり、`u32 × 5` の index 4 も 5 / 4 に分かれる。この分割は端末ローカル /
  キャリアの 14 / 30 と直交していて意味が不明（Q12）
- バケットヘッダの `+4`, `+12..+31`, ピア ID 直後の 8 バイト
- 本文レコード末尾の u32 列。`2097151` (= 0x1FFFFF) が繰り返し現れる
- 各レコード末尾付近に一貫して出る `0xFFFF 0x1F` マーカー（Q11）
