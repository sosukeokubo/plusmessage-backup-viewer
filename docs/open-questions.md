# 未解決の疑問と調査チェックリスト

復元を完成させるために答えを出す必要がある疑問を、優先度順に並べる。
各項目は「どうやって答えを出すか」も明記する（手詰まりを避けるため）。

## ✅ 解決済み

### Q1. `parseInbox` は実ファイルで何件のメッセージを取れているか

**回答 (2026-04-25):** 17 バケット、計 61 メッセージ。
日本語・絵文字・改行すべて含む生 UTF-8 で復元できている。
最大バケットは `+819012340001` で 32 通。
詳細：[findings-2026-04-25.md](./findings-2026-04-25.md) Section 5。
スクリプト：[scripts/analyze.ts](../scripts/analyze.ts)。

### Q1-bis. 復元した SMS は UI まで届いているか

**回答 (2026-04-25 後半):** 届いている。`composeThreadList` 経由で
仮想 thread として注入され、`InboxBubble` で正しくレンダリングされる
（17 件すべて `inboxIndex` ヒット、メッセージ非到達はゼロ）。
"UI に出ていない" という当初仮説は誤り。詳細：
[findings-2026-04-25.md](./findings-2026-04-25.md) Section 10。
スクリプト：[scripts/ui-probe.ts](../scripts/ui-probe.ts)。

## P0: これが分からないと先に進めない

### Q3. 本文は MESSAGES 側にも存在するのか、SETTINGS だけか

**なぜ重要:** SMS は SETTINGS で取れた。しかし 65MB の 99.8% を占める
MESSAGES (0x0005) の本文がどう格納されているかが未着手。これが解けないと
44 実 thread の本文（写真しか出ない）は永久に出ない。

**検証方法:**
- SETTINGS が覆うタイムスタンプ範囲と、MESSAGES 側の thread が覆う
  タイムスタンプ範囲を比較
- 実機で「確実に受信した覚えがあるメッセージ」の本文文字列で grep して、
  バイト単位で見つかるか確認（見つかれば生 UTF-8、見つからなければ圧縮・
  暗号化）
- `zlib` ヘッダ (`78 9c`, `78 01`, `78 da` 等) が thread body のどこに
  出るかを列挙。attachment の zlib-PNG と同じ層で本文も圧縮されている
  仮説の検証

### Q2. 会話 1〜61 とは実際には何か

**なぜ重要:** Q1 解決によって 44 + 17 = 61 と判明。
44 は MESSAGES 側の thread、17 は SMS 受信箱バケット。
ただし 44 thread と 17 bucket が同じ相手に対して重複している可能性は
未確定。Q4 と密接に関連。

**検証方法:**
- 各 thread の `body` の先頭数百バイトを hexdump
- 同じ相手が複数スレッドに分散していないか（たとえば写真 1 枚 = 1 スレッド？
  会話の論理区切りで分かれている？）
- Q4 (peerPhone 解決) が解けると自動的に答えが出る

## P1: 復元品質に直結

### Q4. スレッドと相手の電話番号の紐付け（昇格: 旧 P1 → 現実質 P0）

**なぜ重要:** 現在、44 実 thread すべての `peerPhone` が undefined。
SMS 側で 17 件は phone 紐付き、MESSAGES 側 44 件は紐付かずに分離して
表示されている。これが解けると、SMS と +メッセージが「同じ相手の会話」
として 1 つに統合できる。Q3 (MESSAGES 本文) より小さく早く価値が出る
可能性が高い。

**検証方法:**
- 各 thread body から長さ接頭辞付き `+`-phone を探す
  （inbox.ts の `findAllPeerPhones` をそのまま転用可能）
- 1 thread あたり何個の phone が出るか、最頻出が peer 候補か検証
- `CONTACTS` セクションの phone (85 件) と thread の順序・インデックスに
  対応があるか確認 (CONTACTS 85 ≠ THREAD 44 なので 1:1 ではない)
- thread header の `sizeField` や `flag` に電話番号への参照が埋まって
  いないか

### Q4-bis. 連絡先の名前抽出 (deriveContactName) は実データで動くか

**なぜ重要:** 連絡先 85 件すべてで `name === undefined` が出ている
([findings-2026-04-25.md](./findings-2026-04-25.md) Section 3)。
そのため、Q4 で peer phone が解けても表示名は電話番号のまま。

**検証方法:**
- 数件の Contact について `fields` と `otherRecords` を hexdump
  含めて目視
- 名前データが本当に入っていないのか、`PHONE_LIKE` 正規表現で
  弾きすぎているのかを切り分け
- 入っていないのが確定なら、以降ここに時間をかけない

### Q5. 送受信方向の復元

**なぜ重要:** チャットバブルを左右どちらに寄せるかに必要。

**検証方法:**
- SIP metadata の `|1|1|0|` 部分は全メッセージで本当に同じか、違う値の
  ものを探す
- タイムスタンプの並び方で推定できるか（同相手連続は同方向の傾向、など）
- `backup_owner` の自分の電話番号と、message の UUID や他のフィールドに
  何らかの対応がないか

### Q6. +メッセージ本文の格納場所

**なぜ重要:** SMS は SETTINGS で読めたが、+メッセージ（リッチ本文、
スタンプ、既読）がどこに入っているか不明。

**検証方法:**
- 実機で自分が +メッセージで送受信した文字列（特定の友人との会話冒頭）を
  バイト grep
- thread body 内の未解析領域を集めて、既知フォーマット（Protobuf、
  MessagePack、独自 TLV）との一致を試す

## P2: 解けなくても致命的ではない

### Q7. プリアンブル 126 バイトの中身

**検証方法:** 既知のアプリバージョンで取ったバックアップを複数並べて
差分を取る。

### Q8. CONTACT tail 20 バイトの意味

**検証方法:** 「お気に入り」「ブロック」等のフラグがある連絡先を
片っ端から比較。

### Q9. THREAD header の `flag` と `sizeField`

**検証方法:** `flag=0x00` と `flag=0x01` の thread を hexdump で比較。
`sizeField` と実 body 長との関係（比率、差分）を統計的に。

### Q10. SETTINGS peer bucket の `0x00000039` の意味

**検証方法:** 全バケットで同じ値か確認。違う値があれば、それらに共通する
何か（メッセージ数、相手のプラン種別等）を探す。

### Q11. 0xFFFF 0x1F マーカー

**検証方法:** このマーカーの前後バイトパターンを全出現について列挙し、
共通構造を探す。

## 調査を効率化するために用意したいツール

- ✅ **`scripts/analyze.ts`** — TLV セクション・bucket・message の要約。
  Q1 解決に使用。
- ✅ **`scripts/ui-probe.ts`** — `composeThreadList` + `buildInboxIndex` +
  `resolveThreadContact` を実ファイルでシミュレートし、サイドバーに
  何が出るかを stdout に展開。Q1-bis 解決に使用。
- ⏳ **`scripts/grep-bytes.ts`** — 任意のバイト列（UTF-8 文字列含む）を
  ファイル全域から探し、ヒット箇所前後 32 バイトを hexdump する。
  Q3 (MESSAGES 本文の生 UTF-8 / zlib 探索) で必要。
- ⏳ **`scripts/scan-thread-phones.ts`** — 全 thread body を
  `findAllPeerPhones` で走査し、thread あたりの phone 出現分布を出す。
  Q4 で必要。
- ⏳ **`scripts/diff-backups.ts`** — 複数バックアップの同じセクションを
  並べて差分する（プリアンブル解析や tail 解析に使う）。Q7/Q8 で必要。

これらはテストファイルではなく実ファイルを直接触るため、`test/` ではなく
`scripts/` 以下に置く。ビルドに混入しないよう `tsconfig.json` で除外する。

## 検証ログを残す場所

このドキュメント自体か、あるいは `docs/findings-YYYY-MM-DD.md` のような
日付付きノートに、

- 使ったスクリプト
- 投入したファイル
- 観察された出力（抜粋）
- そこから何を結論したか

をセットで書き残す。後から「この仮説をなぜ採用したか」を辿れるようにする。
