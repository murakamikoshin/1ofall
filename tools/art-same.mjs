/**
 * 同じ部屋に**同じ絵**が並んでいないかを、傾きと大きさを除いて見る。
 *
 * art-check の「全部違う」は書き出し（data: URI）を比べていたので、
 * 手の揺れ（±2度）と縮尺が札ごとに違うぶんで必ず全部違う判定になっていた。
 * 遊んでいる側に見えるのは**形**なので、形だけで比べる。
 */
import { build } from 'esbuild';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { readFileSync } from 'node:fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(tmpdir(), `artsame-${process.pid}.mjs`);
await build({
  stdin: { contents: `export * from './src/ui/placeholder';
    export { treatsFor } from './src/ui/art/modifiers';`, resolveDir: root, loader: 'ts' },
  bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent',
});
const C = await import(pathToFileURL(out).href);
const pack = JSON.parse(readFileSync(resolve(root, 'data/rooms.core.json'), 'utf8'));

/**
 * 手の揺れ（±2度の乱れ）だけを落として、描いてある形にする。
 *
 * 傾き（tilt=14度）と大小（small=0.82 / big=1.1）は**札の言葉から来る違い**なので残す。
 * ここを一緒に落とすと「小さな鍵」と「長い鍵」が同じ絵だと数えてしまう。
 * 影の層は本体と同じ形を筆だけ替えて二度描いたものなので、色を落とせば消える。
 */
const shapeOf = (svg) => {
  const sig = [...svg.matchAll(/rotate\((-?[\d.]+) 64 64\) scale\(([\d.]+)\)/g)]
    .map(([, spin, scale]) => `${Math.abs(Number(spin)) < 6 ? 0 : Math.sign(Number(spin)) * 14}/${scale}`)
    .join(',');
  return sig + '|' + svg
    .replace(/ transform="[^"]*"/g, '')
    .replace(/ (?:fill|stroke)="[^"]*"/g, '')
    .replace(/ opacity="[^"]*"/g, '');
};

let worst = null, biggest = 0, roomsWithDup = 0, dupCards = 0, allCards = 0;
const rows = [];
for (const room of pack.rooms) {
  const shapes = room.choices.map((c, i) =>
    shapeOf(C.artSvg({ theme: room.theme, index: i, key: `${room.id}:${c.id}`, labelEn: c.label.en })));
  const distinct = new Set(shapes).size;
  allCards += room.choices.length;
  const dup = room.choices.length - distinct;
  dupCards += dup;
  if (dup > 0) {
    roomsWithDup++;
    rows.push(`${room.theme}/${room.id}  ${room.choices.length}択→${distinct}種  ${room.choices.map((c) => c.label.ja).join('・')}`);
  }
  if (dup > biggest) { biggest = dup; worst = `${room.theme}/${room.id}（${room.choices.length}択→${distinct}種）`; }
}
rows.sort();
for (const r of rows.slice(0, Number(process.env.SHOW ?? 12))) console.log('  ' + r);
console.log(`\n同じ絵が並ぶ部屋 ${roomsWithDup}/${pack.rooms.length}　重なった札 ${dupCards}/${allCards}（${((dupCards / allCards) * 100).toFixed(0)}%）　最悪 ${worst ?? 'なし'}`);
const LIMIT = Number(process.env.LIMIT ?? 0);
if (LIMIT && dupCards > LIMIT) { console.error(`✗ ${dupCards} > ${LIMIT}`); process.exit(1); }
