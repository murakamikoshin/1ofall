/**
 * 部屋ごとの出来を測る。
 *
 * 通しプレイでは1周20部屋しか見えないので、96部屋のうち
 * 「いつも一目で分かる部屋」「いつも運任せの部屋」が埋もれる。
 * 実物のロジックで全部屋を何度も回して、外れ値だけを出す。
 */
import { build } from 'esbuild';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(tmpdir(), `audit-${process.pid}.mjs`);
await build({
  stdin: { contents: `
    export { corePackage } from './src/core/pack';
    export { castLiars, dealKnowledge } from './src/core/casting';
    export { writeHint, voiceOf, unique } from './src/core/hint-writer';
    export { scoreChoices, bestChoice } from './src/core/read-hints';
    export { MODES, knowledgeForSection, liarCountFor } from './src/core/limits';
    export { createRng, shuffled } from './src/core/rng';
    export { setLocale, localized } from './src/i18n';
  `, resolveDir: root, loader: 'ts' },
  bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent',
});
const C = await import(pathToFileURL(out).href);
C.setLocale(process.env.LOCALE ?? 'ja');

const PASSES = Number(process.env.PASSES ?? 60);
const SEEDS = Number(process.env.SEEDS ?? 5);
const mode = C.MODES[process.env.MODE ?? 'standard'];
const pack = C.corePackage();
let rng = C.createRng(31);

/** ある部屋を1回分回して、読めたかどうかを返す */
function playRoom(room, sectionIndex) {
  const slots = mode.slotsBySection[sectionIndex] ?? 6;
  const ids = Array.from({ length: slots }, (_, i) => `a${i}`);
  const liarIds = [...C.castLiars(ids, rng, mode.loneHonest)];
  const choices = C.shuffled(room.choices, rng);
  const knowledge = C.dealKnowledge(
    choices, room.correct, { speakerIds: ids, liarIds }, rng,
    C.knowledgeForSection(sectionIndex), mode.loneHonest, !!mode.allChallengers,
  );

  const write = (id, nudge = 0) => {
    const k = knowledge.get(id);
    if (!k) return '';
    const v = C.voiceOf(id);
    return C.writeHint({
      choices, knowledge: k, rng,
      liarHonestyRate: mode.liarHonesty, liarMimicRate: mode.liarMimic,
      voice: { ...v, seat: v.seat + nudge },
    });
  };
  const rows = C.unique(ids.map((id) => ({ id, text: write(id) })), write)
    .map((h) => ({ advisorId: h.id, text: h.text, record: { hit: 0, miss: 0 } }));

  // 数えるだけの打ち手（＝素朴な人）が何を選ぶか
  const tally = new Map(choices.map((c) => [c.id, 0]));
  for (const r of rows) {
    for (const c of choices) if (r.text.includes(C.localized(c.label))) tally.set(c.id, tally.get(c.id) + 1);
  }
  const top = Math.max(...tally.values());
  const leaders = choices.filter((c) => tally.get(c.id) === top);
  const crowdRight = leaders.length === 1 && leaders[0].id === room.correct;
  const runaway = leaders.length === 1 && top >= 2 &&
    choices.every((c) => c.id === leaders[0].id || (tally.get(c.id) ?? 0) <= top - 2);

  // 設計どおりの読み手
  const score = C.scoreChoices({ choices, rows, own: null });
  const best = Math.max(...choices.map((c) => score.get(c.id) ?? 0));
  const tied = choices.filter((c) => (score.get(c.id) ?? 0) === best);
  const readRight = C.bestChoice(score, choices, rng) === room.correct;

  return { crowdRight, runaway, luck: tied.length > 1, readRight };
}

/**
 * **種を変えて何度も測る。**
 *
 * 1つの種で最下位を並べると、ほぼ全部が偶然だった。
 * 実際に3つの種で最下位5部屋を出したら、重なったのは1部屋だけで、
 * ある種で最下位の部屋が別の種では最上位に来た。
 * 部屋96・区画4・40回だと1部屋160試行で、標準誤差が3.8%ある。
 *
 * 構造的な欠陥は種を変えても動かない。
 * （実例：選択肢の名前が互いに含まれていた room_017 は
 *  どの種でも平均より17ポイント低かった）
 */
const stats = new Map();
const perSeed = new Map();
for (let seedIndex = 0; seedIndex < SEEDS; seedIndex++) {
  rng = C.createRng(31 + seedIndex * 1009);
  for (let pass = 0; pass < PASSES; pass++) {
    for (const room of pack.rooms) {
      for (let sectionIndex = 0; sectionIndex < mode.sections; sectionIndex++) {
        const r = playRoom(room, sectionIndex);
        const s = stats.get(room.id) ?? { n: 0, crowd: 0, runaway: 0, luck: 0, read: 0, room };
        s.n++;
        s.crowd += r.crowdRight ? 1 : 0;
        s.runaway += r.runaway ? 1 : 0;
        s.luck += r.luck ? 1 : 0;
        s.read += r.readRight ? 1 : 0;
        stats.set(room.id, s);

        const key = `${room.id}|${seedIndex}`;
        const q = perSeed.get(key) ?? { n: 0, read: 0 };
        q.n++;
        q.read += r.readRight ? 1 : 0;
        perSeed.set(key, q);
      }
    }
  }
}

const rows = [...stats.values()].map((s) => ({
  id: s.room.id,
  prompt: s.room.prompt[process.env.LOCALE ?? 'ja'],
  choices: s.room.choices.length,
  crowd: s.crowd / s.n,
  runaway: s.runaway / s.n,
  luck: s.luck / s.n,
  read: s.read / s.n,
}));

const avg = (k) => rows.reduce((a, r) => a + r[k], 0) / rows.length;
console.log(`${rows.length}部屋 × ${PASSES}回 × ${mode.sections}区画 × 種${SEEDS}通り`);
console.log(`（1部屋あたり ${PASSES * mode.sections * SEEDS} 試行）\n`);
console.log(`  群れが当たる      ${(avg('crowd') * 100).toFixed(1)}%`);
console.log(`  一目で分かる      ${(avg('runaway') * 100).toFixed(1)}%`);
console.log(`  運任せ            ${(avg('luck') * 100).toFixed(1)}%`);
console.log(`  読めば当たる      ${(avg('read') * 100).toFixed(1)}%`);

const show = (title, list, fmt) => {
  if (list.length === 0) return;
  console.log(`\n${title}`);
  for (const r of list) console.log(`  ${r.id}  ${fmt(r)}  「${r.prompt}」`);
};

// 揺れの幅を出して、それを超えて外れているものだけを疑う
const mean = avg('read');
const trials = PASSES * mode.sections * SEEDS;
const se = Math.sqrt((mean * (1 - mean)) / trials);
console.log(`  揺れの幅（1部屋・標準誤差）  ±${(se * 100).toFixed(1)}pt`);

const suspect = rows
  .map((r) => {
    // 種ごとにも下振れしているか。偶然なら種によって上下する
    const bySeed = Array.from({ length: SEEDS }, (_, i) => {
      const q = perSeed.get(`${r.id}|${i}`);
      return q ? q.read / q.n : NaN;
    });
    const belowEverySeed = bySeed.every((v) => v < mean);
    return { ...r, bySeed, belowEverySeed, z: (mean - r.read) / se };
  })
  // 3σを超え、どの種でも下振れし、かつ実害のある幅（10pt）で低いものだけ。
  // 7pt の下振れが1部屋あっても、96部屋のうちの1つなら遊びは変わらない。
  // 構造的な壊れ方（選択肢の名前の包含など）は17pt級で出る
  .filter((r) => r.z >= 3 && r.belowEverySeed && mean - r.read >= 0.10)
  .sort((a, b) => b.z - a.z);

console.log(`\n読みが通らない部屋（揺れの3倍を超え、どの種でも低く、10pt以上低い）`);
if (suspect.length === 0) {
  console.log('  なし');
} else {
  for (const r of suspect) {
    console.log(`  ${r.id}  読めば ${(r.read * 100).toFixed(0)}%（平均 ${(mean * 100).toFixed(0)}%、-${r.z.toFixed(1)}σ）  「${r.prompt}」`);
    console.log(`      種ごと: ${r.bySeed.map((v) => `${(v * 100).toFixed(0)}%`).join(' ')}`);
  }
}

if (process.env.STRICT === '1' && suspect.length > 0) {
  console.error(`\n✗ 読みが通らない部屋が ${suspect.length} 件ある`);
  process.exit(1);
}

const N = Number(process.env.TOP ?? 6);
show('一目で分かりすぎる部屋（参考。揺れの中にあることが多い）',
  [...rows].sort((a, b) => b.runaway - a.runaway).slice(0, N),
  (r) => `一目 ${(r.runaway * 100).toFixed(0)}%  群れ的中 ${(r.crowd * 100).toFixed(0)}%`);
