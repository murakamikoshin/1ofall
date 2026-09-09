# 段階4の費用（2026-09-09 調査）

## 結論：**無料で始められる。判断待ちだった前提が古かった。**

`README.md` と `docs/MODES.md` は「PartyKit / Durable Objects に
Cloudflare Workers 有料プラン（$5/月）が**必須**」と書いていた。
**これは2025年4月に変わっている。**

SQLite バックエンドの Durable Objects は **Workers 無料プランで使える**。
PartyKit 自体も、自分の Cloudflare アカウントへ配置する形なら
プラットフォーム料金を取らない（Cloudflare に買収されたため）。

つまり **段階4に着手するのに、支払いの判断は要らない。**

---

## 無料枠（Workers Free）

| 項目 | 無料枠 |
|---|---|
| リクエスト | 100,000 / 日 |
| 実行時間 | 13,000 GB-s / 日 |
| SQLite 読み行 | 5,000,000 / 日 |
| SQLite 書き行 | 100,000 / 日 |
| 保存量 | 合計 5GB（**無料プランは保存量を課金されない**） |

有料（$5/月）は 1,000,000 リクエスト/月 + 400,000 GB-s/月 を含み、
超過は $0.15/百万リクエスト、$12.50/百万 GB-s。

## 何周ぶん回るか

実行時間は **128MB 固定**で数える。つまり 1秒 = 0.125 GB-s。
13,000 GB-s/日 ÷ 0.125 = **104,000 オブジェクト秒/日**（約29時間ぶん）。

1周を15分（`docs/RUBRIC.md` の実測 14.1分）とすると：

| 実装の仕方 | 1周あたり | 無料枠で回る周数/日 |
|---|---|---|
| 眠らせない（素朴な実装） | 112.5 GB-s | **約115周** |
| **眠らせる（Hibernation）** | 1周あたり数百ミリ秒〜数秒 | **数万周** |

リクエスト側は詰まらない。視聴者500人の配信1周で、接続500 +
助言メッセージ（**受信は20通で1リクエスト**）約600 = 約1,100リクエスト。
100,000/日なら**500人配信を1日90周**しても余る。

※ 上表の周数は上の単価から出した見積もり。実測ではない。

---

## 実装の制約（ここだけは外せない）

**WebSocket Hibernation API を使うこと。** 使わないと上表のとおり
コストが100倍以上変わる。眠っているあいだ実行時間は課金されず、
接続は張られたままになる。

そして**60秒の締切をタイマーで持たないこと。**
`setTimeout` で待つとオブジェクトがメモリに居座り、眠れなくなって
Hibernation の意味が消える。**Durable Objects の alarm を使う。**

これは最適化ではなく設計条件として扱う。段階4を書くときの前提。

## 残る支出

| 項目 | 費用 | いつ要るか |
|---|---|---|
| Workers 無料プラン | **¥0** | いま |
| 独自ドメイン | 年 $10 前後 | **要らない。** `*.workers.dev` で検証できる |
| Workers 有料 $5/月 | $5/月 | 無料枠を超えたら。上記のとおり当分来ない |
| Sentry | 無料枠 | — |

## 出典

- [Durable Objects 料金表（cloudflare-docs）](https://github.com/cloudflare/cloudflare-docs/blob/production/src/content/partials/durable-objects/durable-objects-pricing.mdx)
- [Durable Objects on Workers Free plan（2025-04-07 変更履歴）](https://developers.cloudflare.com/changelog/post/2025-04-07-durable-objects-free-tier/)
- [WebSocket の使い方（Hibernation）](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)
- [PartyKit is joining Cloudflare!](https://blog.partykit.io/posts/partykit-is-joining-cloudflare/)
- [cloudflare/partykit](https://github.com/cloudflare/partykit)

## PartyKit を使うか、Durable Objects を直に書くか

PartyKit は Cloudflare 傘下で維持されており、Durable Objects の
薄い包み（PartyServer / PartySocket）として位置づけられている。
置き換えではなく便利層なので、どちらでも `AdvisorGateway` の
差し込み口は変わらない。**この選択は段階4の着手時に決めればよく、
いま決めなくても止まらない。**
