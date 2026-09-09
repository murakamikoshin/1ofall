/**
 * 画面に出ている情報を全部使う打ち手も入れて比べる。
 * 区画のあいだ配役が固定なので、各人の「正n 嘘n」の記録が積まれる。
 * その記録を使う打ち手と、使わない打ち手の差を測る。
 */
import { build } from 'esbuild';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { readFileSync } from 'node:fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(tmpdir(), `core18-${process.pid}.mjs`);
await build({
  stdin: { contents: `export * from './src/core/casting';
                      export * from './src/core/hint-writer';
                      export * from './src/core/limits';
                      export * from './src/core/rng';
                      export { setLocale } from './src/i18n';`, resolveDir: root, loader: 'ts' },
  bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent',
});
const { castSpeakers, castLiars, dealKnowledge, writeHint, voiceOf, liarBias, createRng, RUN, setLocale } =
  await import(pathToFileURL(out).href);
setLocale('ja');

const pack = JSON.parse(readFileSync(resolve(root, 'data/rooms.core.json'), 'utf8'));
const rng = createRng(2024);
const ADV = Array.from({ length: 12 }, (_, i) => ({ id: `ai_${i}`, name: `a${i}`, kind: 'ai' }));
const HEDGE = /たぶん|気がする|に見える|じゃないか|絞れた|決めきれん|どっちか/;
const AVOID = /やめろ|死ぬ|手を出すな|罠だ|だけは違う|だめだ/;

const L = (room) => room.choices.map((c) => ({ id: c.id, label: c.label.ja }));
const best = (s, l) => {
  const m = Math.max(...s.values());
  const t = [...s].filter(([, v]) => v === m).map(([id]) => id);
  return t[Math.floor(rng() * t.length)];
};

/** 各打ち手は (部屋, 助言, 記録) を受け取る。記録は区画のあいだ積まれる */
const POLICIES = {
  '数えるだけ': ({ room, hints }) => {
    const l = L(room); const s = new Map(l.map((c) => [c.id, 0]));
    for (const h of hints) for (const c of l) if (h.text.includes(c.label)) s.set(c.id, s.get(c.id) + 1);
    return best(s, l);
  },
  '断言を疑う（記録は使わない）': ({ room, hints }) => {
    const l = L(room); const s = new Map(l.map((c) => [c.id, 0]));
    for (const h of hints) {
      const t = l.filter((c) => h.text.includes(c.label));
      if (AVOID.test(h.text)) { for (const c of t) s.set(c.id, s.get(c.id) - 0.9); continue; }
      const hedging = t.length >= 2 || HEDGE.test(h.text);
      for (const c of t) s.set(c.id, s.get(c.id) + (hedging ? 1.0 : 0.45));
    }
    return best(s, l);
  },
  '記録で重みを変える': ({ room, hints, rec }) => {
    const l = L(room); const s = new Map(l.map((c) => [c.id, 0]));
    for (const h of hints) {
      const r = rec.get(h.id) ?? { hit: 0, miss: 0 };
      const w = (r.hit + 1) / (r.hit + r.miss + 2);   // 信用の度合い 0〜1
      const t = l.filter((c) => h.text.includes(c.label));
      for (const c of t) s.set(c.id, s.get(c.id) + w);   // 否定の扱いは基準と揃える
    }
    return best(s, l);
  },
  '嘘つき常習者は反転させる': ({ room, hints, rec }) => {
    const l = L(room); const s = new Map(l.map((c) => [c.id, 0]));
    for (const h of hints) {
      const r = rec.get(h.id) ?? { hit: 0, miss: 0 };
      const seen = r.hit + r.miss;
      // 二度以上見て、嘘のほうが多い相手は、言うことを逆に取る
      const flip = seen >= 2 && r.miss > r.hit ? -1 : 1;
      const t = l.filter((c) => h.text.includes(c.label));
      const sign = AVOID.test(h.text) ? -1 : 1;
      const hedging = t.length >= 2 || HEDGE.test(h.text);
      for (const c of t) s.set(c.id, s.get(c.id) + flip * sign * (hedging ? 1.0 : 0.5));
    }
    return best(s, l);
  },
  '嘘つきを完全に知っている（上限）': ({ room, hints, liarIds }) => {
    const l = L(room); const s = new Map(l.map((c) => [c.id, 0]));
    for (const h of hints) {
      const t = l.filter((c) => h.text.includes(c.label));
      const sign = AVOID.test(h.text) ? -1 : 1;
      const flip = liarIds.includes(h.id) ? -1 : 1;
      for (const c of t) s.set(c.id, s.get(c.id) + flip * sign);
    }
    return best(s, l);
  },
};

const names = Object.keys(POLICIES);

function runSections(slots, mix, sections) {
  const wins = Object.fromEntries(names.map((n) => [n, 0]));
  let rooms = 0;
  for (let sec = 0; sec < sections; sec++) {
    const speakerIds = castSpeakers({ advisors: ADV, slots, mode: 'lottery', rng });
    const liarIds = castLiars(speakerIds, rng);
    // 打ち手ごとに別々の記録を持つ（正解が開示されれば誰でも同じ記録が積める）
    const rec = new Map();
    for (let r = 0; r < RUN.roomsPerSection; r++) {
      const room = pack.rooms[Math.floor(rng() * pack.rooms.length)];
      const knowledge = dealKnowledge(room.choices, room.correct, { speakerIds, liarIds }, rng, mix);
      const hints = speakerIds.map((id) => ({
        id,
        text: writeHint({
          choices: room.choices, knowledge: knowledge.get(id), rng,
          liarHonestyRate: 0.55 - Math.min(0.4, liarBias(id) * 0.16), voice: voiceOf(id),
        }),
      }));
      const ctx = { room, hints, rec, liarIds };
      for (const n of names) if (POLICIES[n](ctx) === room.correct) wins[n]++;
      rooms++;
      // 記録は振る舞いで付ける（本体と同じ判定）
      const correctLabel = room.choices.find((c) => c.id === room.correct).label.ja;
      const allLabels = room.choices.map((c) => c.label.ja);
      for (const h of hints) {
        const x = rec.get(h.id) ?? { hit: 0, miss: 0 };
        const mc = h.text.includes(correctLabel);
        const mw = allLabels.some((l) => l !== correctLabel && h.text.includes(l));
        const truthful = AVOID.test(h.text) ? (!mc && mw) : mc;
        truthful ? x.hit++ : x.miss++;
        rec.set(h.id, x);
      }
    }
  }
  return { wins, rooms };
}

console.log('区画のあいだ記録が積まれる状況で比較（各区画条件で30000部屋ぶん）\n');
console.log('打ち手'.padEnd(34) + RUN.slotsBySection.map((_, i) => `区画${i + 1}`).join('    ') + '    平均');
const table = Object.fromEntries(names.map((n) => [n, []]));
RUN.slotsBySection.forEach((slots, i) => {
  const { wins, rooms } = runSections(slots, RUN.knowledgeBySection[i], 5000);
  for (const n of names) table[n].push(wins[n] / rooms * 100);
});
for (const n of names) {
  const avg = table[n].reduce((a, b) => a + b, 0) / 4;
  console.log(n.padEnd(32) + table[n].map((v) => `${v.toFixed(1)}%`.padStart(7)).join('  ') + `  ${avg.toFixed(1)}%`);
}
