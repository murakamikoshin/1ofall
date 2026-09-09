# 画像スタイル指定書

選択肢イラストの生成規約。**この文書を確定してから枚数を回す。**
絵柄が揃わないと一気に安っぽくなり、揃わないまま250枚作ると全部やり直しになる。

## 1. 必要枚数

| 段階 | 部屋数 | 平均選択肢 | 枚数 |
|---|---|---|---|
| **現在（収録済み）** | **79** | 5.3 | **417** |

部屋を48→79に増やしたので、必要枚数は 275 から **417** に増えた。
`npm run images:manifest` で必要なファイル名の一覧が出る。

```bash
npm run images:manifest              # 未生成417枚の一覧
npm run images:manifest -- --test    # 10枚テストぶんだけ（door 5 + food 5）
npm run images:manifest -- --prompts # 下のテンプレートを当てはめた完成プロンプト
```

`--prompts` は §2 のテンプレートに `{SUBJECT}` を差し込んで出す。
**手で書き写さないこと**（規約のずれはそこから入る）。

## 2. 共通プロンプト（テンプレート）

`{SUBJECT}` だけを差し替える。それ以外は**一字も変えない**。
シード値とモデル設定も全枚数で固定する。
`{SUBJECT}` に入るのは部屋データの `label.en`（`scripts/image-manifest.mjs` が差し込む）。

```
A single {SUBJECT}, centered, isolated object illustration.
Style: bold uniform black outline of constant thickness, flat fill,
exactly one hard drop shadow offset down-right, no gradient, no texture,
no cross-hatching, no highlight.
Palette: aged paper background (#C2B192), ink black lines (#14100B),
muted desaturated fills only.
Composition: square 1:1, object centered, generous even margin on all
four sides, front-facing or three-quarter view, no perspective floor,
no background scenery, no text, no watermark, no person unless subject is a person.
Mood: worn, oxidized, dimly lit night market goods.
```

**Negative prompt（共通）**

```
photorealistic, 3d render, gradient, glow, bloom, soft shadow, multiple shadows,
watercolor, sketch lines, cross-hatching, text, letters, numbers, watermark,
signature, border frame, vignette, cropped object, multiple objects, collage
```

## 3. 参照画像

1. まず `door` テーマの5枚を生成し、**最も規約に合う1枚を参照画像に固定する**
2. 以降の全枚数はその参照画像を image reference（weight 中程度）として回す
3. 参照画像を途中で差し替えない。差し替えたら、それ以降は別ロットとして扱う

## 4. 着手手順（この順を飛ばさない）

1. 上のテンプレートで **10枚だけ**生成する（door 5枚 + food 5枚）
2. 10枚を**一覧で並べる**。1枚ずつ見ると揃って見えるので必ず並べる
3. 判定基準（下記）で合否を出す
4. **不合格なら枚数を回さない。** テンプレートを直して1に戻る
5. 合格したら参照画像を固定し、テーマ単位でロットを回す
6. ロットごとに一覧確認 → 浮いた絵を弾いて再生成

## 5. 判定基準（10枚テストの合否）

- [ ] 線の太さが10枚で揃っている（1枚でも細い／太いがあれば不合格）
- [ ] 影の向きと段数が全枚数で同じ（右下・1段）
- [ ] 背景色が同一。**1枚だけ明るい／暗いは即不合格**（それ自体が答えの手掛かりになる）
- [ ] 余白量が揃っている。被写体の大きさが揃っている
- [ ] 縮小して 200px 角にしても何の絵か分かる（配信で小さく映る）
- [ ] 5枚を並べたとき、**どれが正解か絵から推測できない**

最後の項目が最重要。絵の描き込み量や豪華さに差があると、
それが正解のヒントになってしまい、読み合いが壊れる。

## 6. 書き出し

- 形式：**WebP**、品質 80、正方形 512×512
- 命名：`/img/{roomId}_{choiceId}.webp`（例 `/img/room_012_b.webp`）
- 配置：`public/img/`
- 部屋 JSON の `choices[].image` に `/img/room_012_b.webp` と書けば差し替わる

`image` が未指定の間は、コード側が同じ規約の仮絵を描く（`src/ui/placeholder.ts`）。
仮絵と本番絵でレイアウトは変わらないので、差し替えは画像だけで済む。

## 7. まだ決めていないこと（10枚テストが止まっている理由）

- **生成に使うモデル／サービス**（Midjourney / NanoBanana / SDXL など）
- **商用利用と Steam 販売の可否**（フェーズ2で有料販売するため、規約確認が必須）

この二つは繋がっている。**先に決めるのは規約のほう。**
絵柄が気に入っても販売できないサービスなら、10枚テストの結果に意味がない。

選ぶときに満たす必要がある条件：

| 条件 | なぜ |
|---|---|
| 生成物の商用再配布が可能 | Steam で有料販売する |
| **シード固定ができる** | §2「全枚数で固定する」が守れない |
| **参照画像（image reference）が使える** | §3 の参照画像固定が要る |
| 417枚を回せる価格 | 1枚あたりの単価 × 417 |

上2つを満たさない道具（1枚ずつ雰囲気で作る類の生成ツール）は、
**10枚は揃って見えても417枚では揃わない。** §5の合否基準が通らないので候補から外れる。
