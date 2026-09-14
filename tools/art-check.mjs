/**
 * 選択肢の絵が、部屋の中で被っていないかを見る。
 *
 * 族ごとに4種しか用意していなかったので、5択の部屋では必ず二枚が同じ絵になっていた。
 * 「どれを被る」で同じ仮面が二つ並ぶと、絵を見る意味が消えて名前だけを読む遊びになる。
 * 実際に鍵の絵が二枚並んでいた（写しで気づいた）。
 */
import { build } from 'esbuild';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { readFileSync } from 'node:fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(tmpdir(), `art-${process.pid}-${Date.now()}.mjs`);
await build({
  stdin: { contents: `export * from './src/ui/placeholder';
    export { treatsFor } from './src/ui/art/modifiers';`, resolveDir: root, loader: 'ts' },
  bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent',
});
const C = await import(pathToFileURL(out).href);
const pack = JSON.parse(readFileSync(resolve(root, 'data/rooms.core.json'), 'utf8'));

let pass = 0, fail = 0;
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`${ok ? '✓' : '✗'} ${n}${ok ? '' : `  ${d}`}`); };

let worst = null;
let biggest = 0;
const themes = new Set();
for (const room of pack.rooms) {
  themes.add(room.theme);
  const uris = room.choices.map((c, i) => C.choiceArt(room.theme, room.id, c.id, c.image, i, c.label.en));
  const distinct = new Set(uris).size;
  if (room.choices.length - distinct > biggest) {
    biggest = room.choices.length - distinct;
    worst = `${room.id}（${room.choices.length}択のうち${distinct}種）`;
  }
}
check('どの部屋も選択肢ぶんの絵が全部違う', biggest === 0, worst ?? '');

/*
 * 題材が族に載っていないと、既定の「手に持つもの」に落ちる。
 * 96のうち66が落ちていて、氷の上を歩く部屋に鍵や仮面が並んでいた。
 * 部屋を足したときに黙って落ちないよう、ここで止める。
 */
const unmapped = [...themes].filter((t) => !C.hasMotif(t));
check('全部の題材に形がある', unmapped.length === 0, unmapped.join(' '));
console.log(`   ${pack.rooms.length}部屋 / 題材 ${themes.size}種 / 印は題材ごとに ${C.VARIANTS} 種`);

/*
 * 形容が絵に出ているか。
 *
 * 部屋の選択肢は「破れた網／濡れた網／重りのついた網」のように**形容だけが違う**。
 * 形容を読まずに順番で印を振っていた頃は、「取手のない扉」に取手が描かれていた。
 * 半分以上の札が形容に当たらなくなったら、それは表が痩せている合図。
 */
let matched = 0, all = 0;
for (const room of pack.rooms) {
  for (const c of room.choices) {
    all++;
    if (C.treatsFor(c.label.en).length > 0) matched++;
  }
}
check('半分以上の札が形容から描かれている', matched / all >= 0.5, `${((matched / all) * 100).toFixed(0)}%`);
console.log(`   形容から描けている札 ${matched}/${all}`);

/*
 * 絵が枠から出ていないか。
 *
 * 規約 §5 の「余白量が揃っている」を、座標の範囲で見る。
 * 128 の枠に対して 8〜120 に収めていれば、縮めても切れない
 * （影は右下に 4,5 ずれるので、その余地も含めてここで見る）。
 */
let out_of_box = null;
for (const room of pack.rooms) {
  for (const [i, c] of room.choices.entries()) {
    const svg = C.artSvg({ theme: room.theme, index: i, key: `${room.id}:${c.id}`, labelEn: c.label.en });
    // 座標だけを見る（色や線幅や不透明度の数を混ぜない）
    const coords = [
      ...[...svg.matchAll(/ d="([^"]+)"/g)].flatMap((m) => m[1].match(/-?\d+(?:\.\d+)?/g) ?? []),
      ...[...svg.matchAll(/ c[xy]="(-?[\d.]+)"/g)].map((m) => m[1]),
      ...[...svg.matchAll(/<circle[^>]* r="(-?[\d.]+)"/g)].map((m) => m[1]),
    ].map(Number).filter((n) => Number.isFinite(n));
    const nums = coords;
    const bad = nums.filter((n) => n < -6 || n > 124);
    if (bad.length > 0 && !out_of_box) out_of_box = `${room.theme}/${c.label.ja}: ${bad.slice(0, 4).join(' ')}`;
  }
}
check('絵が枠から出ていない', out_of_box === null, out_of_box ?? '');

/*
 * 紙の色を二か所に書いているので、ずれていないかを見る。
 *
 * 絵は正方形で札は横長なので、札の地に紙と同じ色を敷いて一枚の紙に見せている。
 * 片方だけ変えると、札の真ん中に色違いの正方形が浮く。
 */
const style = readFileSync(resolve(root, 'src/ui/art/style.ts'), 'utf8');
const tokens = readFileSync(resolve(root, 'src/ui/tokens.css'), 'utf8');
const paperTs = /export const PAPER = '([^']+)'/.exec(style)?.[1];
const paperCss = /--art-paper:\s*([^;]+);/.exec(tokens)?.[1]?.trim();
check('札の地の色が紙の色と同じ', !!paperTs && paperTs === paperCss, `style.ts=${paperTs} tokens.css=${paperCss}`);

// 部屋ごとに並び順が変わっているか（いつも同じ順だと部屋の違いが出ない）
const firsts = new Set(pack.rooms.map((r) => C.choiceArt(r.theme, r.id, r.choices[0].id, undefined, 0, r.choices[0].label.en)));
check('部屋ごとに始まりの絵が違う', firsts.size >= 6, `${firsts.size}種`);

// 番号を渡さなくても落ちない（渡していない呼び出しが残っていても壊れない）
const legacy = C.choiceArt('door', 'room_001', 'a');
check('番号なしでも絵が出る', typeof legacy === 'string' && legacy.startsWith('data:image/svg'));

// 最大8択でも被らない
const eight = Array.from({ length: 8 }, (_, i) => C.choiceArt('door', 'room_001', `c${i}`, undefined, i));
check('8択でも全部違う', new Set(eight).size === 8, `${new Set(eight).size}種`);

console.log(`\n${pass} 通過 / ${fail} 失敗`);
process.exit(fail ? 1 : 0);
