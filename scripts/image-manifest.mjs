/**
 * 生成が必要な画像の一覧と、そのまま渡せる発注書を出す。
 *
 *   npm run images:manifest          未生成の一覧（file / theme / subject）
 *   npm run images:manifest -- --test  10枚テストぶんだけ（door 5 + food 5）
 *   npm run images:manifest -- --prompts  規約どおりの完成プロンプトを並べる
 *
 * 規約の本文は docs/IMAGE_STYLE.md。ここはその機械可読な写しなので、
 * 片方だけ書き換えないこと。
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = resolve(root, 'data');
const imgDir = resolve(root, 'public/img');

const args = process.argv.slice(2);
const testOnly = args.includes('--test');
const withPrompts = args.includes('--prompts');

/** docs/IMAGE_STYLE.md §2。{SUBJECT} 以外は一字も変えない */
const TEMPLATE = `A single {SUBJECT}, centered, isolated object illustration.
Style: bold uniform black outline of constant thickness, flat fill,
exactly one hard drop shadow offset down-right, no gradient, no texture,
no cross-hatching, no highlight.
Palette: aged paper background (#C2B192), ink black lines (#14100B),
muted desaturated fills only.
Composition: square 1:1, object centered, generous even margin on all
four sides, front-facing or three-quarter view, no perspective floor,
no background scenery, no text, no watermark, no person unless subject is a person.
Mood: worn, oxidized, dimly lit night market goods.`;

const NEGATIVE = `photorealistic, 3d render, gradient, glow, bloom, soft shadow, multiple shadows,
watercolor, sketch lines, cross-hatching, text, letters, numbers, watermark,
signature, border frame, vignette, cropped object, multiple objects, collage`;

/** 10枚テストは door と food の先頭1部屋ずつ（docs/IMAGE_STYLE.md §4-1） */
const TEST_THEMES = ['door', 'food'];

const rows = [];
for (const file of readdirSync(dataDir).filter((f) => f.endsWith('.json'))) {
  const pack = JSON.parse(readFileSync(join(dataDir, file), 'utf8'));
  for (const room of pack.rooms) {
    for (const choice of room.choices) {
      const name = `${room.id}_${choice.id}.webp`;
      rows.push({
        name,
        room: room.id,
        theme: room.theme,
        // 絵の発注は英語表記で出す。プロンプトが英語なので ja を混ぜない
        subject: choice.label.en,
        ja: choice.label.ja,
        done: existsSync(join(imgDir, name)),
      });
    }
  }
}

let missing = rows.filter((r) => !r.done);

if (testOnly) {
  const first = new Map();
  for (const t of TEST_THEMES) {
    const room = rows.find((r) => r.theme === t)?.room;
    if (room) first.set(t, room);
  }
  missing = missing.filter((r) => first.get(r.theme) === r.room);
}

if (withPrompts) {
  console.log(`# 発注書 — ${missing.length}枚`);
  console.log(`# 共通 negative prompt:\n${NEGATIVE}\n`);
  console.log('# シード値とモデル設定は全枚数で固定すること（docs/IMAGE_STYLE.md §2）\n');
  for (const r of missing) {
    console.log(`--- ${r.name}  [${r.theme}] ${r.ja}`);
    console.log(TEMPLATE.replace('{SUBJECT}', r.subject));
    console.log('');
  }
} else {
  console.log(`必要 ${rows.length} 枚 / 未生成 ${missing.length} 枚${testOnly ? '（10枚テストぶん）' : ''}\n`);
  console.log('file\ttheme\tsubject\tja');
  for (const r of missing) console.log(`${r.name}\t${r.theme}\t${r.subject}\t${r.ja}`);
}
