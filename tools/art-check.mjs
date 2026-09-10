/**
 * 仮絵が、部屋の中で被っていないかを見る。
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
  stdin: { contents: `export * from './src/ui/placeholder';`, resolveDir: root, loader: 'ts' },
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
  const uris = room.choices.map((c, i) => C.choiceArt(room.theme, room.id, c.id, c.image, i));
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
const unmapped = [...themes].filter((t) => !C.hasFamily(t));
check('全部の題材が形の族に載っている', unmapped.length === 0, unmapped.join(' '));
console.log(`   ${pack.rooms.length}部屋 / 題材 ${themes.size}種 / 絵柄は族ごとに ${C.VARIANTS} 種`);

// 部屋ごとに並び順が変わっているか（いつも同じ順だと部屋の違いが出ない）
const firsts = new Set(pack.rooms.map((r) => C.choiceArt(r.theme, r.id, r.choices[0].id, undefined, 0)));
check('部屋ごとに始まりの絵が違う', firsts.size >= 6, `${firsts.size}種`);

// 番号を渡さなくても落ちない（渡していない呼び出しが残っていても壊れない）
const legacy = C.choiceArt('door', 'room_001', 'a');
check('番号なしでも絵が出る', typeof legacy === 'string' && legacy.startsWith('data:image/svg'));

// 最大8択でも被らない
const eight = Array.from({ length: 8 }, (_, i) => C.choiceArt('door', 'room_001', `c${i}`, undefined, i));
check('8択でも全部違う', new Set(eight).size === 8, `${new Set(eight).size}種`);

console.log(`\n${pass} 通過 / ${fail} 失敗`);
process.exit(fail ? 1 : 0);
