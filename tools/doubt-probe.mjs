/**
 * 疑いの札を**公開**したらどうなるかを測る。
 *
 * 札はいま画面の中だけにある（送らない・相手にも見えない）。
 * 公開すると配信では強いはずだが、**撃たれる側が振る舞いを変えられる**。
 * 嘘つきが札の付いた者に群がって埋めるようになると、
 * 「撃たれている者ほど本当のことを言っている」という手掛かりが壊れる。
 * それが壊れるかどうかだけを、ここで測る。
 *
 * 挑戦者の札は人の打ち方を真似る——**記録が崩れている者に置く**
 * （記録の道具に入れた手と同じ）。
 *
 *   node tools/doubt-probe.mjs [rate] [seeds]
 */
import { build } from 'esbuild';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { readFileSync } from 'node:fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(tmpdir(), `dp-${process.pid}-${Date.now()}.mjs`);
await build({ stdin: { contents: `export * from './src/core/casting';
  export * from './src/core/hint-writer'; export * from './src/core/limits';
  export * from './src/core/name-calling';
  export * from './src/core/rng'; export { setLocale, strings, localized } from './src/i18n';`,
  resolveDir: root, loader: 'ts' },
  bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent' });
const C = await import(pathToFileURL(out).href);
C.setLocale('ja');
const pack = JSON.parse(readFileSync(resolve(root, 'data/rooms.core.json'), 'utf8'));

const RATE = Number(process.argv[2] ?? 0.3);
const SEEDS = Number(process.argv[3] ?? 8);
const ADV = Array.from({ length: 12 }, (_, i) => ({ id: `ai_${i}`, name: `名${i}`, kind: 'ai' }));
const nameOf = (id) => ADV.find((a) => a.id === id).name;

const MODES = {
  通常: { slots: 8, brink: false, honesty: C.MODES.standard.liarHonesty, mimic: C.MODES.standard.liarMimic },
  崖っぷち: { slots: 4, brink: true, honesty: C.MODES.brink.liarHonesty, mimic: C.MODES.brink.liarMimic },
};

const pct = (a, b) => (b ? `${((a / b) * 100).toFixed(1)}%` : '—');

/** 一つの遊び方を、札の倍率ごとに回す */
function run(mode, pileOn) {
  const acc = {
    rooms: 0, calls: 0,
    byHits: new Map(),          // 撃たれた回数ごとの中身
    marked: 0, markedLiar: 0,   // 札の精度（挑戦者の読み）
    callsOnMarked: 0, callsOnMarkedLiar: 0,
    callsOnFree: 0, callsOnFreeLiar: 0,
  };
  for (let seed = 0; seed < SEEDS; seed++) {
    const rng = C.createRng(9000 + seed * 733);
    for (let section = 0; section < 4; section++) {
      const speakerIds = C.castSpeakers({ advisors: ADV, slots: mode.slots, mode: 'lottery', rng });
      const liarIds = mode.brink
        ? speakerIds.filter((_, i) => i !== Math.floor(rng() * speakerIds.length))
        : C.castLiars(speakerIds, rng);
      const mix = C.RUN.knowledgeBySection[section];
      const rec = new Map();          // 記録（正/嘘）
      const doubted = new Set();      // 挑戦者の札

      for (let r = 0; r < 6; r++) {
        const room = pack.rooms[Math.floor(rng() * pack.rooms.length)];
        const kn = C.dealKnowledge(room.choices, room.correct, { speakerIds, liarIds }, rng, mix, mode.brink, false);
        const labels = room.choices.map((c) => ({ id: c.id, label: C.localized(c.label) }));
        const correctLabel = labels.find((c) => c.id === room.correct).label;

        const said = [];
        for (const id of speakerIds) {
          const text = C.writeHint({
            choices: room.choices, knowledge: kn.get(id), rng,
            liarHonestyRate: Math.max(0.05, Math.min(0.5, mode.honesty * C.liarBias(id))),
            liarMimicRate: mode.mimic, voice: C.voiceOf(id),
          });
          said.push({ id, name: nameOf(id), text });
        }
        // 人を指す口。ここで札を見る（公開した場合の振る舞い）
        const shapes = C.strings().hints;
        for (const id of speakerIds) {
          if (rng() >= RATE) continue;
          const call = C.chooseCall(
            kn.get(id), room.choices, said.filter((x) => x.id !== id), rng,
            pileOn === 1 ? undefined : { doubted, pileOn },
          );
          if (!call) continue;
          const forms = call.doubt ? shapes.doubt : shapes.back;
          const form = forms[Math.floor(rng() * forms.length)];
          said.push({ id, name: nameOf(id), text: form(call.name), kind: 'call', targetId: call.id, doubt: call.doubt });
        }
        acc.rooms++;

        // 撃たれ方を数える
        const hitsOn = new Map();
        for (const s of said.filter((x) => x.kind === 'call' && x.doubt)) {
          acc.calls++;
          hitsOn.set(s.targetId, (hitsOn.get(s.targetId) ?? 0) + 1);
          const isLiar = liarIds.includes(s.targetId);
          if (doubted.has(s.targetId)) {
            acc.callsOnMarked++;
            if (isLiar) acc.callsOnMarkedLiar++;
          } else {
            acc.callsOnFree++;
            if (isLiar) acc.callsOnFreeLiar++;
          }
        }
        for (const id of speakerIds) {
          const n = hitsOn.get(id) ?? 0;
          const b = acc.byHits.get(n) ?? { n: 0, liar: 0, correct: 0 };
          b.n++;
          if (liarIds.includes(id)) b.liar++;
          const mine = said.find((s) => s.id === id && s.kind !== 'call');
          if (mine && mine.text.includes(correctLabel)) b.correct++;
          acc.byHits.set(n, b);
        }

        // 記録を積む（扉について言った者だけ。本体と同じ「振る舞いで付ける」）
        for (const s of said.filter((x) => x.kind !== 'call')) {
          const touched = labels.filter((c) => s.text.includes(c.label));
          if (!touched.length) continue;
          let rest = s.text;
          for (const c of touched) rest = rest.split(c.label).join('　');
          const avoid = C.strings().hints.avoidPattern.test(rest);
          const truthful = avoid ? !s.text.includes(correctLabel) : s.text.includes(correctLabel);
          const v = rec.get(s.id) ?? { hit: 0, miss: 0 };
          if (truthful) v.hit++; else v.miss++;
          rec.set(s.id, v);
        }

        // 挑戦者が札を置き直す（記録が崩れている者に置く＝人の打ち方）
        doubted.clear();
        for (const [id, v] of rec) if (v.miss > v.hit) doubted.add(id);
        for (const id of doubted) {
          acc.marked++;
          if (liarIds.includes(id)) acc.markedLiar++;
        }
      }
    }
  }
  return acc;
}

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  ${detail}`}`);
};

for (const [label, mode] of Object.entries(MODES)) {
  console.log(`\n【${label}】 撃つ率 ${RATE}　種 ${SEEDS}`);
  const rows = [];
  for (const pileOn of [1, 2.5, 6]) {
    const a = run(mode, pileOn);
    const hits2 = [...a.byHits.entries()].filter(([k]) => k >= 2).reduce((s, [, v]) => ({
      n: s.n + v.n, liar: s.liar + v.liar, correct: s.correct + v.correct,
    }), { n: 0, liar: 0, correct: 0 });
    const hits0 = a.byHits.get(0) ?? { n: 0, liar: 0, correct: 0 };
    rows.push({ pileOn, a, hits2, hits0 });
    console.log(`  札の倍率 ${pileOn}`);
    console.log(`    札の精度（置いた相手が嘘つきだった）      ${pct(a.markedLiar, a.marked)}（${a.marked}件）`);
    console.log(`    二人以上から撃たれた者が正解を口にしていた ${pct(hits2.correct, hits2.n)}（${hits2.n}人）`);
    console.log(`    撃たれていない者が正解を口にしていた       ${pct(hits0.correct, hits0.n)}（${hits0.n}人）`);
    console.log(`    札の付いた者への撃ち               ${a.callsOnMarked}件（うち相手が嘘つき ${pct(a.callsOnMarkedLiar, a.callsOnMarked)}）`);
    console.log(`    札の無い者への撃ち                 ${a.callsOnFree}件（うち相手が嘘つき ${pct(a.callsOnFreeLiar, a.callsOnFree)}）`);
  }
  /*
   * 手掛かりが生きているか。
   *
   * **向きは遊び方で逆になる。**
   *   崖っぷち：嘘つきが多数なので、群れが撃つのは真実を言った一人だけ
   *             → 撃たれた者ほど正解を口にしている（実測93.8%）
   *   通常　　：半数が協力者なので、撃つ側にも本当の知識がある
   *             → 撃たれた者は「外れを押していた」側に寄る（実測 −14.5pt）
   * どちらも手掛かりで、向きが違うだけ。見たいのは
   * **札を公開して群がらせても向きが保つか**。
   */
  const base = rows.find((x) => x.pileOn === 1);
  const baseLift = (base.hits2.correct / Math.max(1, base.hits2.n))
    - (base.hits0.correct / Math.max(1, base.hits0.n));
  console.log(`  素の向き ${baseLift > 0 ? '撃たれた者ほど正解を口にする' : '撃たれた者は外れ寄り'}（${(baseLift * 100).toFixed(1)}pt）`);
  for (const { pileOn, hits2, hits0 } of rows) {
    const lift = (hits2.correct / Math.max(1, hits2.n)) - (hits0.correct / Math.max(1, hits0.n));
    // 通常の手掛かりは素で −7pt しかない（崖っぷちは +40pt）。
    // 絶対値で線を引くと通常が常に落ちるので、**素からどれだけ薄れたか**で見る
    check(`${label}/倍率${pileOn}: 手掛かりの向きと強さが保つ`,
      Math.sign(lift) === Math.sign(baseLift) && Math.abs(lift) >= Math.abs(baseLift) * 0.6,
      `素 ${(baseLift * 100).toFixed(1)}pt → ${(lift * 100).toFixed(1)}pt`);
  }
}

console.log(`\n${pass} 通過 / ${fail} 失敗`);
process.exit(fail > 0 ? 1 : 0);
