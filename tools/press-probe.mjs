/**
 * 「押す」——疑いの札を置かれた者に**言い切らせる**手を測る。
 *
 * 札はここまで、置いても相手の振る舞いを変えない印だった（25回目に公開はした）。
 * 公開しただけでは、置く側の損得は「嘘つきが群がる」＝**損しかない**。
 * 置く手に得を付けるなら、押された者の口を狭めるのが素直だ——
 * 扉ひとつを名指しして、迷いの言い方を使えない（`writeHint` の `pressed`）。
 *
 * 見たいのは三つ。
 *
 *   1. 押すと記録が早く固まるか（嘘つきは罠を押すしかないので崩れるはず）
 *   2. 代金が本当に払われているか（押した相手の「迷い」は読めなくなる。
 *      迷いは強い手掛かりなので、そこを捨てることになる）
 *   3. 何枚まで許すか（全員を押せるなら、区画の終わりには配役が割れてしまう）
 *
 *   node tools/press-probe.mjs [seeds]
 */
import { build } from 'esbuild';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { readFileSync } from 'node:fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(tmpdir(), `pp-${process.pid}-${Date.now()}.mjs`);
await build({ stdin: { contents: `export * from './src/core/casting';
  export * from './src/core/hint-writer'; export * from './src/core/limits';
  export * from './src/core/name-calling';
  export * from './src/core/rng'; export { setLocale, strings, localized } from './src/i18n';`,
  resolveDir: root, loader: 'ts' },
  bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent' });
const C = await import(pathToFileURL(out).href);
C.setLocale('ja');
const pack = JSON.parse(readFileSync(resolve(root, 'data/rooms.core.json'), 'utf8'));

const SEEDS = Number(process.argv[2] ?? 10);
const ADV = Array.from({ length: 12 }, (_, i) => ({ id: `ai_${i}`, name: `名${i}`, kind: 'ai' }));
const nameOf = (id) => ADV.find((a) => a.id === id).name;
const AVOID = C.strings().hints.avoidPattern;
const HEDGE = C.strings().hints.hedgePattern;
const pct = (a, b) => (b ? `${((a / b) * 100).toFixed(1)}%` : '—');
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const sd = (a) => {
  const m = mean(a);
  return a.length ? Math.sqrt(mean(a.map((x) => (x - m) ** 2))) : 0;
};

const MODES = {
  通常: { slots: 8, brink: false, honesty: C.MODES.standard.liarHonesty, mimic: C.MODES.standard.liarMimic },
  崖っぷち: { slots: 4, brink: true, honesty: C.MODES.brink.liarHonesty, mimic: C.MODES.brink.liarMimic },
};

/**
 * 一つの遊び方を、札の枚数ごとに回す。
 * maxMarks=0 で押さない（いまの形）。Infinity で全員押せる形。
 */
function run(mode, maxMarks) {
  const acc = {
    rooms: 0, pressed: 0,
    // 押された一言が当たっていたか（立場ごと）
    pressedTruth: { liar: { n: 0, ok: 0 }, honest: { n: 0, ok: 0 } },
    // 迷いの言い方が場にどれだけ残っているか（押すと減る＝手掛かりを捨てている）
    hedges: 0, hints: 0,
    // 区画の終わりの記録。嘘つきと協力者がどれだけ分かれたか
    trust: { liar: [], honest: [] },
    // 挑戦者が「記録で重み付け」で読んだときの当たり
    read: { n: 0, ok: 0 },
  };
  for (let seed = 0; seed < SEEDS; seed++) {
    const rng = C.createRng(6100 + seed * 613);
    for (let section = 0; section < 4; section++) {
      const speakerIds = C.castSpeakers({ advisors: ADV, slots: mode.slots, mode: 'lottery', rng });
      const liarIds = mode.brink
        ? speakerIds.filter((_, i) => i !== Math.floor(rng() * speakerIds.length))
        : C.castLiars(speakerIds, rng);
      const mix = C.RUN.knowledgeBySection[section];
      const rec = new Map();
      let marks = [];

      for (let r = 0; r < 5; r++) {
        const room = pack.rooms[Math.floor(rng() * pack.rooms.length)];
        const kn = C.dealKnowledge(room.choices, room.correct, { speakerIds, liarIds }, rng, mix, mode.brink, false);
        const labels = room.choices.map((c) => ({ id: c.id, label: C.localized(c.label) }));
        const correctLabel = labels.find((c) => c.id === room.correct).label;
        const marked = new Set(marks);

        const said = [];
        for (const id of speakerIds) {
          const press = marked.has(id);
          const text = C.writeHint({
            choices: room.choices, knowledge: kn.get(id), rng,
            liarHonestyRate: Math.max(0.05, Math.min(0.5, mode.honesty * C.liarBias(id))),
            liarMimicRate: mode.mimic, voice: C.voiceOf(id),
            liarHonest: rng() < C.liarHonestyAt(id, r, 5),
            pressed: press,
          });
          said.push({ id, name: nameOf(id), text, pressed: press });
          acc.hints++;
          const touched = labels.filter((c) => text.includes(c.label));
          let rest = text;
          for (const c of touched) rest = rest.split(c.label).join('　');
          if (touched.length >= 2 || HEDGE.test(rest)) acc.hedges++;
          if (press) {
            acc.pressed++;
            const avoid = AVOID.test(rest);
            const ok = avoid ? !text.includes(correctLabel) : text.includes(correctLabel);
            const box = liarIds.includes(id) ? acc.pressedTruth.liar : acc.pressedTruth.honest;
            box.n++;
            if (ok) box.ok++;
          }
        }
        acc.rooms++;

        // 挑戦者の読み（記録で重み付け。本体で一番強い打ち手に近い形）
        const score = new Map(labels.map((c) => [c.id, 0]));
        for (const s of said) {
          const w = ((rec.get(s.id)?.hit ?? 0) + 1) / ((rec.get(s.id)?.hit ?? 0) + (rec.get(s.id)?.miss ?? 0) + 2);
          const touched = labels.filter((c) => s.text.includes(c.label));
          let rest = s.text;
          for (const c of touched) rest = rest.split(c.label).join('　');
          const avoid = AVOID.test(rest);
          for (const c of touched) score.set(c.id, score.get(c.id) + (avoid ? -w : w));
        }
        const best = Math.max(...score.values());
        const tops = [...score.entries()].filter(([, v]) => v === best).map(([k]) => k);
        acc.read.n++;
        if (tops[Math.floor(rng() * tops.length)] === room.correct) acc.read.ok++;

        // 記録を積む
        for (const s of said) {
          const touched = labels.filter((c) => s.text.includes(c.label));
          if (!touched.length) continue;
          let rest = s.text;
          for (const c of touched) rest = rest.split(c.label).join('　');
          const avoid = AVOID.test(rest);
          const ok = avoid ? !s.text.includes(correctLabel) : s.text.includes(correctLabel);
          const v = rec.get(s.id) ?? { hit: 0, miss: 0 };
          if (ok) v.hit++; else v.miss++;
          rec.set(s.id, v);
        }

        // 札を置き直す（記録が崩れている者から、許された枚数まで）
        if (maxMarks > 0) {
          marks = [...rec.entries()]
            .filter(([, v]) => v.miss > v.hit)
            .sort((a, b) => (b[1].miss - b[1].hit) - (a[1].miss - a[1].hit))
            .slice(0, maxMarks === Infinity ? speakerIds.length : maxMarks)
            .map(([id]) => id);
        }
      }

      for (const id of speakerIds) {
        const v = rec.get(id);
        if (!v || v.hit + v.miss === 0) continue;
        const t = (v.hit + 1) / (v.hit + v.miss + 2);
        (liarIds.includes(id) ? acc.trust.liar : acc.trust.honest).push(t);
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
  console.log(`\n【${label}】 種 ${SEEDS}`);
  const rows = [];
  for (const [name, maxMarks] of [['押さない', 0], ['札2枚', 2], ['全員押す', Infinity]]) {
    const a = run(mode, maxMarks);
    const sep = (() => {
      const lm = mean(a.trust.liar), hm = mean(a.trust.honest);
      const pooled = Math.sqrt((sd(a.trust.liar) ** 2 + sd(a.trust.honest) ** 2) / 2);
      return { gap: hm - lm, d: pooled ? (hm - lm) / pooled : 0 };
    })();
    rows.push({ name, a, sep });
    console.log(`  ${name}`);
    console.log(`    押された一言 ${a.pressed}件　当たり：嘘つき ${
      pct(a.pressedTruth.liar.ok, a.pressedTruth.liar.n)}（${a.pressedTruth.liar.n}件）　協力者 ${
      pct(a.pressedTruth.honest.ok, a.pressedTruth.honest.n)}（${a.pressedTruth.honest.n}件）`);
    console.log(`    記録の分かれ具合（差÷ばらつき）  ${sep.d.toFixed(2)}　差 ${sep.gap.toFixed(3)}`);
    console.log(`    迷いの言い方が場に残る率        ${pct(a.hedges, a.hints)}`);
    console.log(`    記録で読んだときの当たり        ${pct(a.read.ok, a.read.n)}`);
  }
  const base = rows[0], two = rows[1], all = rows[2];
  const readRate = (x) => x.a.read.ok / Math.max(1, x.a.read.n);

  /*
   * 押す手に得があるか。
   *
   * 押された者は言い切るので、次の部屋で正誤が付く＝記録が早く固まる。
   * 嘘つきは罠を押すしかなくなり、当たり率が落ちる（実測 15%前後。
   * 押された協力者は 54%）。読む側の当たりが上がっていなければ、
   * 押す手は損しかない飾りなので入れない。
   */
  check(`${label}: 押すと読みが良くなる`,
    readRate(two) > readRate(base),
    `${pct(base.a.read.ok, base.a.read.n)} → ${pct(two.a.read.ok, two.a.read.n)}`);

  /*
   * 代金が払われているか。押した相手の「迷い」は読めなくなる。
   * 迷いはこのゲームで一番強い手掛かりなので、これが減らないなら
   * 押す手は一方的な得になる（釣り合っていない）。
   */
  check(`${label}: 代金が払われている（迷いが場から減る）`,
    two.a.hedges / two.a.hints < base.a.hedges / base.a.hints,
    `${pct(base.a.hedges, base.a.hints)} → ${pct(two.a.hedges, two.a.hints)}`);

  /*
   * 押された一言の当たりが、立場で分かれているか。
   * ここが揃ってしまうと、言い切らせても何も読めない。
   */
  const pl = two.a.pressedTruth.liar, ph = two.a.pressedTruth.honest;
  if (ph.n >= 30) {
    check(`${label}: 押された一言の当たりが立場で分かれる（20pt以上）`,
      ph.ok / ph.n - pl.ok / pl.n >= 0.2,
      `嘘つき ${pct(pl.ok, pl.n)} / 協力者 ${pct(ph.ok, ph.n)}`);
  } else {
    // 崖っぷちは協力者が一人しかいないので、押される側にまず入らない
    check(`${label}: 押される協力者がほとんど居ない遊び方（${ph.n}件）`, true);
  }

  /*
   * 記録の分かれ具合が崩れていないか。
   * 押すと協力者も言い切る（二択で守れない）ので少しは縮む。
   * 崩れる（7割を切る）なら、押す手が読み合いそのものを潰している。
   */
  check(`${label}: 記録の分かれ具合が崩れない`,
    two.sep.d >= base.sep.d * 0.7,
    `${base.sep.d.toFixed(2)} → ${two.sep.d.toFixed(2)}`);

  console.log(`  全員押した場合の読み  ${pct(all.a.read.ok, all.a.read.n)}（押さない ${pct(base.a.read.ok, base.a.read.n)}）`);
}

console.log(`\n${pass} 通過 / ${fail} 失敗`);
process.exit(fail > 0 ? 1 : 0);
