/**
 * 同じ部屋に**同じ絵**が並んでいないかを見る。
 *
 * art-check の「全部違う」は書き出し（data: URI）を比べていたので、
 * 手の揺れ（±2度）が札ごとに違うぶんで**必ず全部違う判定になっていた。**
 * 遊んでいる側に見えるのは形なので、揺れだけ落として、
 * 札の言葉から来る傾き（tilt）と大小（small/big）は残して比べる。
 *
 *   node tools/art-same.mjs          並んでいる組を見る（SHOW=30 で本数）
 *   LIMIT=0 node tools/art-same.mjs  一組でもあれば落とす（npm test）
 */
import { build } from 'esbuild';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { readFileSync } from 'node:fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(tmpdir(), `artsame-${process.pid}.mjs`);
await build({
  stdin: { contents: `export * from './src/ui/placeholder';`, resolveDir: root, loader: 'ts' },
  bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent',
});
const C = await import(pathToFileURL(out).href);
const pack = JSON.parse(readFileSync(resolve(root, 'data/rooms.core.json'), 'utf8'));

/**
 * 一枚を「傾き・大小」と「引いてある線の集まり」に分ける。
 *
 * 手の揺れ（±2度の乱れ）は札ごとの鍵から引くので落とす。
 * 傾き（tilt=14度）と大小（small=0.82 / big=1.1）は**札の言葉から来る違い**なので残す
 * （ここを落とすと「小さな鍵」と「長い鍵」を同じ絵だと数えてしまう）。
 * 影の層は本体と同じ形を筆だけ替えて二度描いたものなので、線の集まりでは重複が消える。
 */
const shapeOf = (svg) => {
  const form = [...svg.matchAll(/rotate\((-?[\d.]+) 64 64\) scale\(([\d.]+)\)/g)]
    // 揺れは ±2 度、傾き（tilt）は +14 度。足して 8 度以上なら傾きが入っている
    .map(([, spin, scale]) => `${Number(spin) >= 8 ? 14 : 0}/${scale}`)
    .join(',');
  const lines = new Set([
    ...[...svg.matchAll(/ d="([^"]+)"/g)].map((m) => m[1]),
    ...[...svg.matchAll(/<circle cx="([-\d.]+)" cy="([-\d.]+)" r="([-\d.]+)"/g)].map((m) => m.slice(1).join(' ')),
  ]);
  return { form, lines };
};

/**
 * 二枚が同じ絵に見えるか。
 *
 * 文字列で比べるだけでは足りなかった。「隠れない」は「樽の中」と同じ樽で、
 * 違いは**消された一本**（omit で内側の線が落ちる）だけ。しかもその線は
 * `M40 40 H88` で、樽の輪郭 `M40 40 H88 L94 100 H34 Z` の**書き出しと同じ**。
 * つまり輪郭の上に重ねて引いていたので、あっても無くても見た目が変わらない。
 *
 * 逆に「取手のない扉」は、点（取手）が丸ごと無いぶん**見て分かる**ので、
 * 線の集まりが少ないだけでは同じ絵とは数えない。
 * **多いほうの余りが、少ないほうのどれかの線の一部でしかないとき**だけ同じと見る。
 */
const sameLook = (a, b) => {
  if (a.form !== b.form) return false;
  const [small, big] = a.lines.size <= b.lines.size ? [a.lines, b.lines] : [b.lines, a.lines];
  if (![...small].every((d) => big.has(d))) return false;
  const extra = [...big].filter((d) => !small.has(d));
  return extra.every((d) => [...small].some((s) => s !== d && s.includes(d)));
};

let worst = null, biggest = 0, roomsWithDup = 0, dupPairs = 0, allCards = 0;
const rows = [];
for (const room of pack.rooms) {
  const shapes = room.choices.map((c, i) =>
    shapeOf(C.artSvg({ theme: room.theme, index: i, key: `${room.id}:${c.id}`, labelEn: c.label.en })));
  allCards += room.choices.length;
  /*
   * **対で数える。**「同じ絵に見える」は移る関係ではない
   * （印の無い一枚は、印の付いた全部の下敷きになる）ので、
   * 束にまとめると一部屋が丸ごと一種に見えてしまう。
   */
  const pairs = [];
  for (let a = 0; a < shapes.length; a++) {
    for (let b = a + 1; b < shapes.length; b++) {
      if (sameLook(shapes[a], shapes[b])) pairs.push([room.choices[a].label.ja, room.choices[b].label.ja]);
    }
  }
  dupPairs += pairs.length;
  if (pairs.length > 0) {
    roomsWithDup++;
    rows.push(`${room.theme}/${room.id}  ${pairs.map(([x, y]) => `${x}＝${y}`).join('　')}`);
  }
  if (pairs.length > biggest) { biggest = pairs.length; worst = `${room.theme}/${room.id}（${pairs.length}組）`; }
}
rows.sort();
for (const r of rows.slice(0, Number(process.env.SHOW ?? 12))) console.log('  ' + r);
console.log(`\n同じ絵が並ぶ部屋 ${roomsWithDup}/${pack.rooms.length}　同じに見える組 ${dupPairs}（札 ${allCards}枚）　最悪 ${worst ?? 'なし'}`);
const LIMIT = process.env.LIMIT === undefined ? null : Number(process.env.LIMIT);
if (LIMIT === null) process.exit(0);
const ok = dupPairs <= LIMIT;
console.log(`${ok ? '✓' : '✗'} 同じ部屋に同じ絵が並んでいない（${dupPairs}組 / 許容 ${LIMIT}組）`);
process.exit(ok ? 0 : 1);
