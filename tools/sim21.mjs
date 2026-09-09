/** 実物の助言文で、嘘つきの人数を変えた場合を測る */
import { build } from 'esbuild';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { readFileSync } from 'node:fs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(tmpdir(), `c21-${process.pid}.mjs`);
await build({ stdin: { contents: `export * from './src/core/casting';
  export * from './src/core/hint-writer'; export * from './src/core/limits';
  export * from './src/core/rng'; export { setLocale } from './src/i18n';`, resolveDir: root, loader: 'ts' },
  bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent' });
const { castSpeakers, dealKnowledge, writeHint, voiceOf, liarBias, createRng, RUN, setLocale } =
  await import(pathToFileURL(out).href);
setLocale('ja');
const pack = JSON.parse(readFileSync(resolve(root, 'data/rooms.core.json'), 'utf8'));
const rng = createRng(9001);
const ADV = Array.from({ length: 12 }, (_, i) => ({ id: `ai_${i}`, name: `a${i}`, kind: 'ai' }));
const HEDGE = /たぶん|気がする|に見える|じゃないか|絞れた|決めきれん|どっちか/;
const AVOID = /やめろ|死ぬ|手を出すな|罠だ|だけは違う|だめだ/;
const pick = (a) => a[Math.floor(rng() * a.length)];

const DIST = {
  '固定2人（いまの形）': (m) => 2,
  '0〜半分': (m) => Math.floor(rng() * (Math.floor(m / 2) + 1)),
  '0〜過半+1': (m) => Math.floor(rng() * (Math.floor(m / 2) + 2)),
  '0〜m-1（全員嘘もあり）': (m) => Math.floor(rng() * m),
  '山なり（2人前後が多い）': (m) => {
    const r = rng();
    if (r < 0.10) return 0;
    if (r < 0.35) return 1;
    if (r < 0.60) return 2;
    if (r < 0.78) return Math.floor(m / 2);
    if (r < 0.92) return Math.floor(m / 2) + 1;
    return m - 1;
  },
};

const WEIGHT = {
  '数えるだけ': () => 1,
  '信用比で重み付け': (x) => (x.hit + 1) / (x.hit + x.miss + 2) * 2,
  '嘘つきは切り捨て': (x) => (x.hit + x.miss >= 1 && x.miss > x.hit ? 0 : 1),
  '嘘つきは反転': (x) => (x.hit + x.miss >= 1 && x.miss > x.hit ? -1 : 1),
};

function score(room, hints, rec, weightName) {
  const wf = WEIGHT[weightName];
  const l = room.choices.map((c) => ({ id: c.id, label: c.label.ja }));
  const s = new Map(l.map((c) => [c.id, 0]));
  for (const h of hints) {
    const w = wf(rec.get(h.id) ?? { hit: 0, miss: 0 });
    const t = l.filter((c) => h.text.includes(c.label));
    const sign = AVOID.test(h.text) ? -1 : 1;
    const hedging = t.length >= 2 || HEDGE.test(h.text);
    for (const c of t) s.set(c.id, s.get(c.id) + w * sign * (hedging ? 1.0 : 0.6));
  }
  const max = Math.max(...s.values());
  return pick([...s].filter(([, v]) => v === max).map(([id]) => id));
}

function section(slots, mix, liarGen, weightName, byRoom) {
  const speakerIds = castSpeakers({ advisors: ADV, slots, mode: 'lottery', rng });
  const liars = new Set();
  const want = Math.min(liarGen(speakerIds.length), speakerIds.length - 1);
  while (liars.size < want) liars.add(pick(speakerIds));
  const liarIds = [...liars];
  const rec = new Map();
  let alive = 0;
  for (let r = 0; r < RUN.roomsPerSection; r++) {
    const room = pack.rooms[Math.floor(rng() * pack.rooms.length)];
    const kn = dealKnowledge(room.choices, room.correct, { speakerIds, liarIds }, rng, mix);
    const hints = speakerIds.map((id) => ({ id, text: writeHint({
      choices: room.choices, knowledge: kn.get(id), rng,
      liarHonestyRate: 0.55 - Math.min(0.4, liarBias(id) * 0.16), voice: voiceOf(id) }) }));
    const ok = score(room, hints, rec, weightName) === room.correct;
    if (ok) alive++;
    if (byRoom) byRoom[r] += ok ? 1 : 0;
    for (const id of speakerIds) {
      const x = rec.get(id) ?? { hit: 0, miss: 0 };
      liarIds.includes(id) ? x.miss++ : x.hit++;
      rec.set(id, x);
    }
  }
  return alive / RUN.roomsPerSection;
}

const wnames = Object.keys(WEIGHT);
console.log('実物の助言文。区画のあいだ配役固定。発言8人／目利き80%（区画1相当）\n');
console.log('嘘つきの人数'.padEnd(24) + wnames.map((n) => n.padStart(14)).join('') + '    腕の差');
for (const [label, gen] of Object.entries(DIST)) {
  const T = 6000;
  const vals = [];
  for (const wn of wnames) {
    let a = 0;
    for (let t = 0; t < T; t++) a += section(8, RUN.knowledgeBySection[0], gen, wn, null);
    vals.push(a / T * 100);
  }
  const gap = Math.max(...vals.slice(1)) - vals[0];
  const ok = Math.max(...vals) >= 72 && Math.max(...vals) <= 90 && gap >= 8 ? ' ★' : '';
  console.log(label.padEnd(22) + vals.map((v) => `${v.toFixed(1)}%`.padStart(14)).join('') +
    `   ${gap >= 0 ? '+' : ''}${gap.toFixed(1)}pt${ok}`);
}
