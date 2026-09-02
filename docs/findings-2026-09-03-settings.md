# 2026-09-03 SETTINGS は入れ子 TLV だった — 本文 45 通の取りこぼしとメディアの日時復元

`docs/open-questions.md` の残課題「メディア配信レコードの解読」に着手したところ、
そのレコードを含む **SETTINGS セクション全体が構造化された入れ子 TLV** である
ことが分かった。結果として当初の目的（画像に日時と方向を付ける）だけでなく、
**本文の 40% を取りこぼしていたバグ**と **Q10** も同時に解決した。

使用スクリプト: [scripts/scan-settings.ts](../scripts/scan-settings.ts)
（`pnpm tsx scripts/scan-settings.ts ./PlusMessage.backup`）

以下の数値はすべて実ファイル 1 件（65MB）に対する観測値。掲載する電話番号・
氏名・本文はすべて架空の置き換え（[CLAUDE.md](../CLAUDE.md) の方針）。

## 1. きっかけ — 44 個の `<file-name>`

SETTINGS content (114,709 B) に `<file-name>` が **ちょうど 44 回**現れる。
THREAD (0x0006) レコード数 44 と一致する。ところがそれらの手前に
`findAllAnchors` が探すメッセージアンカーは無く、最寄りのアンカーは 927 バイト
離れた別のメッセージだった。**別の枠組みのレコードが存在する**ことになる。

先頭 3 件の間隔が 1107, 1107 バイトと等間隔だったので、その手前をダンプすると
TLV ヘッダが見えた。

```
12338  03 00 | 49 04 00 00 | 49 04 00 00     type=0x0003 field1=1097 contentLen=1097
```

`readTlv` と同じ 10 バイトヘッダ（u16 type + u32 field1 + u32 contentLen）である。

## 2. 観測 — セクション全体が TLV ストリームとして閉じる

content の先頭 4 バイトを件数として読み飛ばし、そこから TLV を辿ると
**114,709 / 114,709 バイトが誤差ゼロで消費される**。

```
=== 1. framing ===
section content   : 114709 B
declared peers    : 20
buckets walked    : 20
bytes consumed    : 114709 (exact)
```

```
SETTINGS content
├ u32 = 20                              ピア数
└ TLV(0x0002) × 20                      ピア バケット（ピア ID 昇順）
   ├ header (field1 バイト)
   └ TLV(0x0003) × n → TLV(0x0004)      レコード列と終端
```

「アンカーを総当たりで探す」必要はそもそも無かった。

## 3. Q10 の回答 — バケットの `0x39` は定数ではない

バケット TLV の `field1` は 3 種類の値を取り、いずれも
**`44 + ピア ID のバイト長`** に一致した。

| ピア ID | 長さ | field1 |
|---|---|---|
| `+819012340001` | 13 | 57 (= 0x39) |
| `operator@kw.ncs.spmode.ne.jp` | 28 | 72 |
| `docomoPlusMessagePoint@maap.plus-msg.com` | 40 | 84 |

差分が 15 と 27 で ID 長の差と完全に一致する。これまで「常に 0x39 を観測」と
書いていたのは、たまたま 18/20 が 13 桁の電話番号だったため。

バケットヘッダの中身:

```
+0   u32   後続する 0x0003 レコード数
+8   u32   うちメディアの件数
+32  u32   ピア ID のバイト長
+36  <ピア ID>
```

`+4`, `+12..+31`, ID 直後の 8 バイトは未解読。実装ではレコード数とメディア数を
`SettingsPeer.declared` に載せ、デコード結果と突き合わせられるようにした
（20 バケット中 20 件で一致）。

## 4. 最大の発見 — 本文 45 通の取りこぼし

0x0003 レコードは共通の前段を持つ。

```
[u16 variant][u16 0x0003][u32 seq]
[u32 len][contact blob]        相手（GS 区切り、末尾に RS で囲んだピア ID）
[u32 len][contact blob]        2 個目。多くのレコードでは長さ 0
[u32 × 5][i64 timestamp]
```

`variant` が 0 なら本文、4 ならメディア。本文レコードでは
**5 個の u32 のうち index 0 が方向、index 3 が経路**だった。

| index 0 (方向) | index 3 (経路) | MIME | 件数 | 旧パーサ |
|---|---|---|---|---|
| 7 = 受信 | 5 = SMS | `text/plain;charset=utf-8` | 62 | ✅ |
| 7 = 受信 | 4 = +メッセージ | `text/plain` | **45** | ❌ **全滅** |
| 6 = 送信 | 4 = +メッセージ | `text/plain` | 5 | ✅ |

旧実装の `ANCHOR_INCOMING` = `{7,1,0,5,0}` と `ANCHOR_OUTGOING` = `{6,1,0,4,0}` は、
この 5 個の u32 を **バイト列としてリテラルに** 探していた。方向と経路が独立した
2 軸であることに気づいておらず、`{7,1,0,4,0}`（受信 × +メッセージ）を登録して
いなかった。したがって受信 +メッセージ 45 通が 1 通も UI に出ていなかった。

「アンカー」という呼び方自体が誤りだった。あれはレコードの先頭を示す目印では
なく、**レコード内部のフィールド値がたまたま固定長で並んでいた**だけである。

```
=== 3. messages by direction × transport ===
    62  incoming sms  (55.4%)
    45  incoming rcs  (40.2%)
     5  outgoing rcs  (4.5%)
  total 112 bodies
```

66 通 → **112 通**（うち本文が空でないもの 111 通、残り 1 通は
`application/vnd.gsma.botmessage` の非テキスト）。

本文レコードの後段:

```
[i64 送信時刻][str 本文][str MIME][str メッセージ ID][str SIP メタデータ]
[u32][i64 保存時刻] …
```

SIP メタデータは長さ 0 のことが多い。方向は SIP からではなくレコード先頭の
`kind` から取る（実ファイルの SIP From/To は全件
`<sip:anonymous@anonymous.invalid>` で判別に使えない）。

## 5. メディア配信レコード（当初の目的）

`variant = 4` のレコードの後段:

```
[u32 × 2][i64 資材の有効期限][u32 × 2]
[str 取得元パス][str カテゴリ][u32]
[str サムネの MIME][str 配信 ID][str RCS <file> XML]
```

RCS XML は `type="thumbnail"` と `type="file"` の 2 つの `<file-info>` を持ち、
`<file-name>` は後者にしかない。これが THREAD レコードとの結合キーになる。

```
<file-info type="file">
  <file-size>202200</file-size>
  <file-name>3f2a91c7-0b4d-4e18-9a52-6c7d8e0f1a2b</file-name>
  <content-type>image/png</content-type>
  <data url="https://a-wss.kw.ncs.spmode.ne.jp/…" until="2024-01-11T09:26:34.516+00:00"/>
</file-info>
```

**注意点:** レコード内の MIME フィールドはサムネの型（`image/png`）であって
本体の型ではない。実際に GIF スタンプでもここは `image/png` になる。本体の型は
XML の `type="file"` 側から取る必要がある。

カテゴリ文字列でスタンプと写真が区別できる。

```
=== 4. media deliveries ===
deliveries       : 44
by direction     : incoming=30 outgoing=14
by content type  : image/png (sticker)=17 image/gif (sticker)=12 image/jpeg=14 image/png=1
with file size   : 44
with expiry      : 44
```

## 6. THREAD との結合 — 名前だけでは足りない

`MediaHeader.name`（THREAD 側）と `<file-name>`（SETTINGS 側）で 44 件中 38 件が
結合できたが、6 件が外れた。

```
THREAD   : "IMG_20230330_174646_1681607355610.jpg"
descriptor: "IMG_20230330_174646.jpg"
```

**端末から送った写真は、ローカル保存時にファイル名へ保存時刻（epoch ms）が
付加される。** ただし `sourcePath` は両者で完全に一致するので、これを第 2 の
キーにすると 42 件になった。

残り 2 件は、同じスタンプを 2 回送ったために名前も取得元パスも完全に同一の
レコードが 2 組できていたケース。曖昧なキーを捨てるのではなく、**ファイル順に
1 対 1 で割り当てる**ことにした。根拠は、一意に結合できた 36 件で THREAD の
並び順と配信レコードの並び順が**反転ゼロで一致**していたこと。

結果 **44/44 が解決**し、全添付にタイムスタンプが付いた。

## 7. メディアの送受信方向（仮説）

方向を直接示すフィールドは**特定できていない**。採用したのは取得元による推定:

| 取得元 | 件数 | 解釈 |
|---|---|---|
| `0,https://a-wss…` (キャリア資材サーバ) | 30 | 受信 |
| `0,app://photos-kit/…`, `0,/var/mobile/…` (端末) | 14 | 送信 |

RCS のファイル転送では受信側は URL しか持たず、ローカルの実体を持つのは送信側
だけ、という理屈による。

**裏取り:** 別セクションである THREAD の `headerFlag`（0 = 端末ローカル、
1 = DL 済み）による分割が **14 / 30 で完全に一致**した。

```
cross-check: headerFlag=0 (device-local) 14 vs outgoing-by-source 14 ✓ agree
```

独立した 2 つの観測が同じ分割を与えているので採用したが、デコードされた方向
フィールドではない。Q12 として残す。

## 8. 未解明のまま残したもの

- **Q12**: メディアレコードで 2 個目の contact blob を持つものが 24 件、持たない
  ものが 20 件あり、同時に 5 個目の u32 が 5 / 4 に分かれる。この 20/24 の分割は
  端末ローカル/キャリアの 14/30 とは**直交している**。意味は不明。
- **Q13**: docomo 公式アカウントのバケットにある `variant = 8` のレコード
  （564 B）。contact blob に `isbot true` を含み、サービス定義と読める。会話
  レコードではないので `SettingsPeer.unknownRecords` として件数だけ数えている。
- バケットヘッダの `+4`, `+12..+31`, ID 直後の 8 バイト。
- 本文レコード末尾の u32 列（`2097151` = 0x1FFFFF が繰り返し現れる）。

## 9. UI への反映

「会話 N 件」と「写真 N 枚」という 2 つのセクションを廃止し、**本文と画像を時刻順
に 1 本のタイムライン**へ統合した。スタンプは吹き出し枠なしで画像のみ表示する。

ブラウザ実機確認 (playwright-cli, `localhost:5174`):

- サイドバー 20 会話、最大の会話は「メッセージ80 · 写真43」
- 詳細ペインは「会話 123 件」= 本文 80 + メディア 43 が時系列に混在
- 吹き出しの左右: 本文 受信 75 / 送信 5、メディア 受信 29 / 送信 14
- 画像 43/43 がレイジーロードでデコード成功、コンソールエラー 0 件
- スタンプ 29 件は枠なし・自然な縦横比、写真 14 件は従来の正方形タイル
