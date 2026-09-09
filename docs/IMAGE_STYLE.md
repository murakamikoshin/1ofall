# 画像スタイル指定書

選択肢イラストの生成規約。**この文書を確定してから枚数を回す。**
絵柄が揃わないと一気に安っぽくなり、揃わないまま250枚作ると全部やり直しになる。

## 1. 必要枚数

| 段階 | 部屋数 | 平均選択肢 | 枚数 |
|---|---|---|---|
| 現在（収録済み） | 30 | 5.3 | **160** |
| 目標（50部屋） | 50 | 5.5 | **275** |

`npm run images:manifest` で、必要なファイル名の一覧が出る。

## 2. 共通プロンプト（テンプレート）

`{SUBJECT}` だけを差し替える。それ以外は**一字も変えない**。
シード値とモデル設定も全枚数で固定する。

```
A single {SUBJECT}, centered, isolated object illustration.
Style: bold uniform black outline of constant thickness, flat fill,
exactly one hard drop shadow offset down-right, no gradient, no texture,
no cross-hatching, no highlight.
Palette: aged paper background (#C2B192), ink black lines (#14100B),
muted desaturated fills only.
Composition: square 1:1, object centered, generous even margin on all
four sides, front-facing or three-quarter view, no perspective floor,
no background scenery, no text, no watermark, no人物 unless subject is a person.
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

## 7. まだ決めていないこと

- 生成に使うモデル／サービス（Midjourney / NanoBanana / SDXL など）
- 商用利用と Steam 販売の可否（**フェーズ2で有料販売するため、規約確認が必須**）
