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
// 言語で読み物の厚みが変わる（英語のラベルは長いので、収まる型が減る）
/*
 * 言語で読み物の厚みが変わる。英語のラベルは長いので、上限に収まる型が減り、
 * 選べないぶんだけ同じ言い方が並ぶ。日本語だけ見て英語を4種のまま
 * 置いていたことがある（23回目）。
 */
let LOC = process.env.LANG_CODE ?? 'ja';
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

const PAIRS = process.env.MODE || process.env.LANG_CODE
  ? [[LOC, process.env.MODE ?? 'standard']]
  // 崖っぷちは発言枠が4しかないので、言語の差が出るのは通常モード
  : [['ja', 'standard'], ['ja', 'brink'], ['en', 'standard']];
for (const [loc, modeId] of PAIRS) {
  LOC = loc;
  C.setLocale(loc);
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
/**
 * 人ごとの型の使い分け（常連が「その人らしく」喋っているか）。
 *
 * 27回目に顔ぶれを周をまたいで固定した。覚える相手が同じなら、
 * **口ぶりで人が分かる**ほうがいい——「ゲンさんはいつも言い切る」が
 * 分かって初めて、それが崩れた部屋に引っかかれる。
 * 席（`voiceOf` の seat）で型の順を固定してあるが、実際に
 * 見分けられる強さは一度も数えていなかった。
 */
const byPerson = new Map();   // 人 → (型 → 回数)

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
      const mine = byPerson.get(a.advisorId) ?? new Map();
      mine.set(frame, (mine.get(frame) ?? 0) + 1);
      byPerson.set(a.advisorId, mine);
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
console.log(`\n【${modeId}/${LOC}】 ${rooms}部屋　扉についての一言 ${doorLines}件　型を引けなかった ${unknown}件`);
console.log(`  1部屋あたりの型の数（平均）  ${avgDistinct.toFixed(1)} / 一言 ${avgLines.toFixed(1)}件 = ${(spread * 100).toFixed(0)}%`);
console.log(`  使われた型                  ${seen.size}種`);
console.log(`  同じ型が一部屋で重なった最大 ${worst}回　${worstRoom}`);
const families = {};
for (const [frame, n] of seen) {
  const fam = frame.replace(/\d+$/, '');
  families[fam] = (families[fam] ?? 0) + n;
}
console.log(`  族ごとの件数                ${Object.entries(families).map(([f, n]) => `${f} ${n}`).join(' / ')}`);

/*
 * 口ぶりで人が分かるか。
 *
 *   一番使う型の割合   その人の一言のうち、一番よく使う型が占める割合
 *   見分けの精度       「この型を一番よく使うのは誰か」で話者を当てた率
 *                     （でたらめに当てると 1/人数）
 */
const people = [...byPerson.entries()].filter(([, m]) => [...m.values()].reduce((a, b) => a + b, 0) >= 8);
const topShare = people.map(([, m]) => {
  const total = [...m.values()].reduce((a, b) => a + b, 0);
  return Math.max(...m.values()) / total;
});
const avgTop = topShare.reduce((a, b) => a + b, 0) / Math.max(1, topShare.length);
// 型ごとに「一番よく使う人」を決めて、その型の一言を全部その人のものと当ててみる
const ownerOf = new Map();
for (const [frame] of seen) {
  let best = null, bestN = 0;
  for (const [id, m] of people) {
    const n = m.get(frame) ?? 0;
    if (n > bestN) { bestN = n; best = id; }
  }
  if (best) ownerOf.set(frame, best);
}
let guessed = 0, guessable = 0;
for (const [id, m] of people) {
  for (const [frame, n] of m) {
    guessable += n;
    if (ownerOf.get(frame) === id) guessed += n;
  }
}
const chance = 1 / Math.max(1, people.length);
/*
 * 人が実際に読むのは**族**のほう（言い切る／迷う／二つ挙げる／警告する）。
 * 28種の型を覚える人はいないが、「あいつはいつも警告する」は覚える。
 * そこで族だけで同じ物差しを当てる。
 */
const famOf = (frame) => frame.replace(/\d+$/, '');
const famByPerson = new Map();
for (const [id, m] of people) {
  const f = new Map();
  for (const [frame, n] of m) f.set(famOf(frame), (f.get(famOf(frame)) ?? 0) + n);
  famByPerson.set(id, f);
}
const famTop = [...famByPerson.values()].map((f) => {
  const total = [...f.values()].reduce((a, b) => a + b, 0);
  return Math.max(...f.values()) / total;
});
const avgFamTop = famTop.reduce((a, b) => a + b, 0) / Math.max(1, famTop.length);
const famOwner = new Map();
for (const fam of new Set([...famByPerson.values()].flatMap((f) => [...f.keys()]))) {
  let best = null, bestShare = 0;
  for (const [id, f] of famByPerson) {
    const total = [...f.values()].reduce((a, b) => a + b, 0);
    const share = (f.get(fam) ?? 0) / Math.max(1, total);
    if (share > bestShare) { bestShare = share; best = id; }
  }
  if (best) famOwner.set(fam, best);
}
console.log(`  人ごとの一番使う族の割合    ${(avgFamTop * 100).toFixed(0)}%　（族は ${famOwner.size}種）`);
console.log(`  人ごとの一番使う型の割合    ${(avgTop * 100).toFixed(0)}%（${people.length}人）`);
console.log(`  口ぶりで話者を当てた率      ${((guessed / Math.max(1, guessable)) * 100).toFixed(0)}%　（でたらめなら ${(chance * 100).toFixed(0)}%）`);
check(`${LOC}/${modeId}: 口ぶりで人が分かる（でたらめの2倍以上）`,
  guessed / Math.max(1, guessable) >= chance * 2,
  `${((guessed / Math.max(1, guessable)) * 100).toFixed(0)}% / でたらめ ${(chance * 100).toFixed(0)}%`);
check(`${LOC}/${modeId}: 一人が同じ型ばかりではない（8割未満）`,
  avgTop < 0.8, `${(avgTop * 100).toFixed(0)}%`);

const tripled = repeats.filter((n) => n >= 3).length;
const tripleRate = tripled / Math.max(1, repeats.length);
console.log(`  3回以上重なった部屋          ${tripled}/${repeats.length}（${(tripleRate * 100).toFixed(1)}%）`);

check(`${LOC}/${modeId}: 型を文面から引けている`, unknown < doorLines * 0.05, `${unknown}/${doorLines}`);
check(`${LOC}/${modeId}: 一言のほとんどが違う言い方（75%以上）`, spread >= 0.75, `${(spread * 100).toFixed(0)}%`);
/*
 * 「一度も重ならない」は基準にできない。5人が言い方を選ぶので、
 * 何十部屋も回せばどこかで三人が同じ型を引く（誕生日の問題）。
 * 見るのは**四人並ばないこと**と、三人並ぶ部屋がまれであること。
 */
check(`${LOC}/${modeId}: 同じ言い方が四人並ばない`, worst <= 3, `${worst}回　${worstRoom}`);
check(`${LOC}/${modeId}: 三人並ぶ部屋がまれ（1割未満）`, tripleRate < 0.10, `${(tripleRate * 100).toFixed(1)}%`);
check(`${LOC}/${modeId}: 一周で20種以上が使われる`, seen.size >= 20, `${seen.size}種`);
}

console.log(`\n${pass} 通過 / ${fail} 失敗`);
process.exit(fail > 0 ? 1 : 0);
