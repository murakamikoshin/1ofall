/**
 * 場に並ぶ言葉が、同じ言い方の繰り返しになっていないか。
 *
 * 8人が一部屋で喋る。**同じ型が二度三度並ぶと、読むのは名前だけになる。**
 * 8回目に名指しを足した理由もこれで（「並ぶのは8つの独白で会話が起きない」）、
 * 型そのものの数が足りていないかは数えていなかった。
 *
 * 型は文面から逆に引く（札を差し込んだ全通りを作って突き合わせる）ので、
 * 言い方を足したら数字がそのまま動く。
 */
import { build } from 'esbuild';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { readFileSync } from 'node:fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(tmpdir(), `voice-${process.pid}-${Date.now()}.mjs`);
await build({
  stdin: { contents: `export * from './src/core/engine';
    export * from './src/core/ai-advisors'; export * from './src/core/limits';
    export { setLocale, strings, localized } from './src/i18n';`, resolveDir: root, loader: 'ts' },
  bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent',
});
const C = await import(pathToFileURL(out).href);
C.setLocale('ja');
const pack = JSON.parse(readFileSync(resolve(root, 'data/rooms.core.json'), 'utf8'));

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  ${detail}`}`);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** 札を差し込んだ全通りから、文面 → 型の索引を作る */
function frameIndex(labels) {
  const H = C.strings().hints;
  const idx = new Map();
  const put = (text, id) => { if (!idx.has(text)) idx.set(text, id); };
  for (const l of labels) {
    H.push.forEach((f, i) => put(f(l), `push${i}`));
    H.hedge.forEach((f, i) => put(f(l), `hedge${i}`));
    H.avoid.forEach((f, i) => put(f(l), `avoid${i}`));
  }
  for (const a of labels) {
    for (const b of labels) {
      if (a === b) continue;
      H.narrow.forEach((f, i) => put(f(a, b), `narrow${i}`));
    }
  }
  H.doubt.forEach((f, i) => put('＿', `doubt${i}`)); // 名前は札ではないので別に見る
  return idx;
}

for (const modeId of (process.env.MODE ? [process.env.MODE] : ['standard', 'brink'])) {
await runMode(modeId);
}

async function runMode(modeId) {
const mode = C.MODES[modeId];
const seen = new Map();       // 型 → 回数
let rooms = 0, worst = 0, worstRoom = '';
let unknown = 0, doorLines = 0;
const perRoomDistinct = [];
const perRoomLines = [];
const repeats = [];

for (let seed = 1; seed <= 6; seed++) {
  const gateway = new C.AiAdvisorGateway({ count: 12, mode, seed: 500 + seed, minDelayMs: 4, maxDelayMs: 16 });
  const engine = new C.GameEngine({ pack, gateway, mode, seed });
  engine.start();
  for (let r = 0; r < 30; r++) {
    const s0 = engine.snapshot();
    if (s0.phase === 'gameover' || s0.phase === 'cleared' || !s0.round) break;
    await wait(200);
    const round = engine.snapshot().round;
    if (!round) break;
    const labels = round.room.choices.map((c) => C.localized(c.label));
    const idx = frameIndex(labels);
    const door = round.advice.filter((a) => (a.kind ?? 'door') === 'door');
    if (door.length === 0) { engine.choose(round.room.choices[0].id); for (let i = 0; i < 4; i++) engine.advancePresentation(); continue; }
    rooms++;
    const count = new Map();
    for (const a of door) {
      doorLines++;
      const frame = idx.get(a.text);
      if (!frame) { unknown++; continue; }
      count.set(frame, (count.get(frame) ?? 0) + 1);
      seen.set(frame, (seen.get(frame) ?? 0) + 1);
    }
    perRoomDistinct.push(count.size);
    perRoomLines.push(door.length);
    const max = Math.max(0, ...count.values());
    repeats.push(max);
    if (max > worst) {
      worst = max;
      const dupe = [...count.entries()].find(([, n]) => n === max)?.[0] ?? '';
      worstRoom = `${C.localized(round.room.prompt)}／${dupe} が ${max}回`;
    }
    // 名の挙がった扉を選んで進む
    const tally = new Map(round.room.choices.map((c) => [c.id, 0]));
    for (const a of door) {
      for (const c of round.room.choices) {
        if (a.text.includes(C.localized(c.label))) tally.set(c.id, (tally.get(c.id) ?? 0) + 1);
      }
    }
    engine.choose([...tally.entries()].sort((x, y) => y[1] - x[1])[0][0]);
    for (let i = 0; i < 4; i++) { engine.advancePresentation(); await wait(6); }
  }
}

const avgDistinct = perRoomDistinct.reduce((a, b) => a + b, 0) / Math.max(1, perRoomDistinct.length);
const avgLines = perRoomLines.reduce((a, b) => a + b, 0) / Math.max(1, perRoomLines.length);
// 発言枠はモードで違う（通常8・崖っぷち4）。数ではなく**比**で見る
const spread = avgDistinct / Math.max(1, avgLines);
console.log(`\n【${modeId}】 ${rooms}部屋　扉についての一言 ${doorLines}件　型を引けなかった ${unknown}件`);
console.log(`  1部屋あたりの型の数（平均）  ${avgDistinct.toFixed(1)} / 一言 ${avgLines.toFixed(1)}件 = ${(spread * 100).toFixed(0)}%`);
console.log(`  使われた型                  ${seen.size}種`);
console.log(`  同じ型が一部屋で重なった最大 ${worst}回　${worstRoom}`);
const families = {};
for (const [frame, n] of seen) {
  const fam = frame.replace(/\d+$/, '');
  families[fam] = (families[fam] ?? 0) + n;
}
console.log(`  族ごとの件数                ${Object.entries(families).map(([f, n]) => `${f} ${n}`).join(' / ')}`);

const tripled = repeats.filter((n) => n >= 3).length;
const tripleRate = tripled / Math.max(1, repeats.length);
console.log(`  3回以上重なった部屋          ${tripled}/${repeats.length}（${(tripleRate * 100).toFixed(1)}%）`);

check(`${modeId}: 型を文面から引けている`, unknown < doorLines * 0.05, `${unknown}/${doorLines}`);
check(`${modeId}: 一言のほとんどが違う言い方（75%以上）`, spread >= 0.75, `${(spread * 100).toFixed(0)}%`);
/*
 * 「一度も重ならない」は基準にできない。5人が言い方を選ぶので、
 * 何十部屋も回せばどこかで三人が同じ型を引く（誕生日の問題）。
 * 見るのは**四人並ばないこと**と、三人並ぶ部屋がまれであること。
 */
check(`${modeId}: 同じ言い方が四人並ばない`, worst <= 3, `${worst}回　${worstRoom}`);
check(`${modeId}: 三人並ぶ部屋がまれ（1割未満）`, tripleRate < 0.10, `${(tripleRate * 100).toFixed(1)}%`);
check(`${modeId}: 一周で20種以上が使われる`, seen.size >= 20, `${seen.size}種`);
}

console.log(`\n${pass} 通過 / ${fail} 失敗`);
process.exit(fail > 0 ? 1 : 0);
