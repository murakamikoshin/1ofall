/**
 * 同じ部屋・同じ助言を、複数の打ち手に同時に食わせて比べる（対応のある比較）。
 * 「この読み合いは数えるだけで解けるのか」を正面から測る。
 */
import { build } from 'esbuild';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { readFileSync } from 'node:fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(tmpdir(), `core17-${process.pid}.mjs`);
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
const rng = createRng(31337);
const ADV = Array.from({ length: 12 }, (_, i) => ({ id: `ai_${i}`, name: `a${i}`, kind: 'ai' }));
const HEDGE = /たぶん|気がする|に見える|じゃないか|絞れた|決めきれん|どっちか/;
const AVOID = /やめろ|死ぬ|手を出すな|罠だ|だけは違う|だめだ/;

function makeRoom(slots, mix) {
  const room = pack.rooms[Math.floor(rng() * pack.rooms.length)];
  const speakerIds = castSpeakers({ advisors: ADV, slots, mode: 'lottery', rng });
  const liarIds = castLiars(speakerIds, rng);
  const knowledge = dealKnowledge(room.choices, room.correct, { speakerIds, liarIds }, rng, mix);
  const hints = speakerIds.map((id) => ({
    id,
    text: writeHint({
      choices: room.choices, knowledge: knowledge.get(id), rng,
      liarHonestyRate: 0.55 - Math.min(0.4, liarBias(id) * 0.16), voice: voiceOf(id),
    }),
  }));
  return { room, hints, liarIds };
}

const L = (room) => room.choices.map((c) => ({ id: c.id, label: c.label.ja }));
const best = (s, l) => {
  const m = Math.max(...s.values());
  const t = [...s].filter(([, v]) => v === m).map(([id]) => id);
  return t[Math.floor(rng() * t.length)];
};

const POLICIES = {
  '当てずっぽう': ({ room }) => { const l = L(room); return l[Math.floor(rng() * l.length)].id; },

  '名前が出た回数を数えるだけ': ({ room, hints }) => {
    const l = L(room); const s = new Map(l.map((c) => [c.id, 0]));
    for (const h of hints) for (const c of l) if (h.text.includes(c.label)) s.set(c.id, s.get(c.id) + 1);
    return best(s, l);
  },

  '数える＋否定は引く': ({ room, hints }) => {
    const l = L(room); const s = new Map(l.map((c) => [c.id, 0]));
    for (const h of hints) {
      const t = l.filter((c) => h.text.includes(c.label));
      const neg = AVOID.test(h.text);
      for (const c of t) s.set(c.id, s.get(c.id) + (neg ? -1 : 1));
    }
    return best(s, l);
  },

  '断言を疑い迷いを信じる（設計）': ({ room, hints }) => {
    const l = L(room); const s = new Map(l.map((c) => [c.id, 0]));
    for (const h of hints) {
      const t = l.filter((c) => h.text.includes(c.label));
      if (AVOID.test(h.text)) { for (const c of t) s.set(c.id, s.get(c.id) - 0.9); continue; }
      const hedging = t.length >= 2 || HEDGE.test(h.text);
      for (const c of t) s.set(c.id, s.get(c.id) + (hedging ? 1.0 : 0.45));
    }
    return best(s, l);
  },

  '嘘つきを知っている（上限）': ({ room, hints, liarIds }) => {
    const l = L(room); const s = new Map(l.map((c) => [c.id, 0]));
    for (const h of hints) {
      if (liarIds.includes(h.id)) continue;      // 嘘つきの発言を全部捨てられる場合
      const t = l.filter((c) => h.text.includes(c.label));
      if (AVOID.test(h.text)) { for (const c of t) s.set(c.id, s.get(c.id) - 1); continue; }
      for (const c of t) s.set(c.id, s.get(c.id) + 1);
    }
    return best(s, l);
  },
};

const names = Object.keys(POLICIES);
console.log('同じ部屋・同じ助言を全部の打ち手に食わせた（各20000部屋）\n');
console.log('打ち手'.padEnd(34) + RUN.slotsBySection.map((s, i) => `区画${i + 1}`).join('    ') + '    平均');

const results = {};
for (const n of names) results[n] = [];
RUN.slotsBySection.forEach((slots, i) => {
  const mix = RUN.knowledgeBySection[i];
  const wins = Object.fromEntries(names.map((n) => [n, 0]));
  const N = 20000;
  for (let k = 0; k < N; k++) {
    const r = makeRoom(slots, mix);
    for (const n of names) if (POLICIES[n](r) === r.room.correct) wins[n]++;
  }
  for (const n of names) results[n].push(wins[n] / N * 100);
});

for (const n of names) {
  const avg = results[n].reduce((a, b) => a + b, 0) / 4;
  console.log(n.padEnd(32) + results[n].map((v) => `${v.toFixed(1)}%`.padStart(7)).join('  ') + `  ${avg.toFixed(1)}%`);
}
