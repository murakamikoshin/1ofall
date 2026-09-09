/** 罠つきの形で、嘘つきの割合を詰める */
import { build } from 'esbuild';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { readFileSync, writeFileSync } from 'node:fs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const limitsPath = resolve(root, 'src/core/limits.ts');
const original = readFileSync(limitsPath, 'utf8');
const pack = JSON.parse(readFileSync(resolve(root, 'data/rooms.core.json'), 'utf8'));
const HEDGE = /たぶん|気がする|に見える|じゃないか|絞れた|決めきれん|どっちか/;
const AVOID = /やめろ|死ぬ|手を出すな|罠だ|だけは違う|だめだ/;

console.log('罠を共有する形。嘘つきの割合ごとの結果\n');
console.log('嘘つき割合   数えるだけ  記録で重み付け   腕の差   独走率  独走時的中');

for (const frac of [0.25, 0.32, 0.40, 0.50, 0.62]) {
  writeFileSync(limitsPath, original.replace(/export const LIAR_FRACTION = [\d.]+;/, `export const LIAR_FRACTION = ${frac};`));
  const out = join(tmpdir(), `c23-${process.pid}-${frac}.mjs`);
  await build({ stdin: { contents: `export * from './src/core/casting';
    export * from './src/core/hint-writer'; export * from './src/core/limits';
    export * from './src/core/rng'; export { setLocale } from './src/i18n';`, resolveDir: root, loader: 'ts' },
    bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent' });
  const M = await import(pathToFileURL(out).href + `?v=${frac}`);
  M.setLocale('ja');
  const rng = M.createRng(4711);
  const ADV = Array.from({ length: 12 }, (_, i) => ({ id: `ai_${i}`, name: `a${i}`, kind: 'ai' }));
  const pick = (a) => a[Math.floor(rng() * a.length)];

  const stats = { total: 0, runaway: 0, hit: 0 };
  const score = (room, hints, rec, useRec) => {
    const l = room.choices.map((c) => ({ id: c.id, label: c.label.ja }));
    const s = new Map(l.map((c) => [c.id, 0]));
    for (const h of hints) {
      const w = useRec
        ? (() => { const x = rec.get(h.id) ?? { hit: 0, miss: 0 }; return (x.hit + 1) / (x.hit + x.miss + 2); })()
        : 1;
      for (const c of l) if (h.text.includes(c.label)) s.set(c.id, s.get(c.id) + w);
    }
    const mx = Math.max(...s.values());
    return pick([...s].filter(([, v]) => v === mx).map(([id]) => id));
  };

  const run = (useRec, collect) => {
    let alive = 0, n = 0;
    for (let t = 0; t < 4000; t++) {
      const speakerIds = M.castSpeakers({ advisors: ADV, slots: 8, mode: 'lottery', rng });
      const liarIds = M.castLiars(speakerIds, rng);
      const rec = new Map();
      for (let r = 0; r < 6; r++) {
        const room = pack.rooms[Math.floor(rng() * pack.rooms.length)];
        const kn = M.dealKnowledge(room.choices, room.correct, { speakerIds, liarIds }, rng, M.RUN.knowledgeBySection[0]);
        const hints = speakerIds.map((id) => ({ id, text: M.writeHint({
          choices: room.choices, knowledge: kn.get(id), rng,
          liarHonestyRate: Math.max(0.05, Math.min(0.45, (1 - M.LIE_RATE) * M.liarBias(id))),
          voice: M.voiceOf(id) }) }));
        if (score(room, hints, rec, useRec) === room.correct) alive++;
        n++;
        if (collect) {
          const counts = new Map(room.choices.map((c) => [c.id, 0]));
          for (const h of hints) for (const c of room.choices) if (h.text.includes(c.label.ja)) counts.set(c.id, counts.get(c.id) + 1);
          const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
          stats.total++;
          if (sorted[0][1] - sorted[1][1] >= 2) { stats.runaway++; if (sorted[0][0] === room.correct) stats.hit++; }
        }
        const cl = room.choices.find((c) => c.id === room.correct).label.ja;
        const all = room.choices.map((c) => c.label.ja);
        for (const h of hints) {
          const x = rec.get(h.id) ?? { hit: 0, miss: 0 };
          const mc = h.text.includes(cl);
          const mw = all.some((l) => l !== cl && h.text.includes(l));
          (AVOID.test(h.text) ? (!mc && mw) : mc) ? x.hit++ : x.miss++;
          rec.set(h.id, x);
        }
      }
    }
    return alive / n * 100;
  };

  const a = run(false, true), b = run(true, false);
  const ok = b >= 75 && b <= 86 && b - a >= 5 && stats.runaway / stats.total < 0.5 ? ' ★' : '';
  console.log(`${(frac * 100).toFixed(0)}%        ${a.toFixed(1)}%      ${b.toFixed(1)}%      +${(b - a).toFixed(1)}pt   ` +
    `${(stats.runaway / stats.total * 100).toFixed(0)}%    ${(stats.hit / stats.runaway * 100).toFixed(0)}%${ok}`);
}
writeFileSync(limitsPath, original);
