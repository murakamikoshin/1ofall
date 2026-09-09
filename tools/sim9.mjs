/** 開封数の規則を決めるための総当たり */
import { build } from 'esbuild';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { readFileSync } from 'node:fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(tmpdir(), `core9-${process.pid}.mjs`);
await build({
  stdin: { contents: `export * from './src/core/casting';
                      export * from './src/core/hint-writer';
                      export * from './src/core/limits';
                      export * from './src/core/rng';`, resolveDir: root, loader: 'ts' },
  bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent',
});
const { castRound, writeHint, liarCountFor, createRng } = await import(pathToFileURL(out).href);
const pack = JSON.parse(readFileSync(resolve(root, 'data/rooms.core.json'), 'utf8'));
const rng = createRng(999);
const ADVISORS = Array.from({ length: 12 }, (_, i) => ({ id: `ai_${i}`, name: `a${i}`, kind: 'ai' }));

function decide(room, hints) {
  const score = new Map(room.choices.map((c) => [c.id, 0]));
  for (const { text } of hints) {
    for (const c of room.choices) {
      if (!text.includes(c.label)) continue;
      score.set(c.id, (score.get(c.id) ?? 0) + (/やめろ|罠|手を出すな|死ぬぞ/.test(text) ? -1 : 1));
    }
  }
  const max = Math.max(...score.values());
  const top = [...score].filter(([, v]) => v === max).map(([id]) => id);
  return top[Math.floor(rng() * top.length)];
}

function rate(slots, K, n = 40000) {
  let alive = 0;
  for (let i = 0; i < n; i++) {
    const room = pack.rooms[Math.floor(rng() * pack.rooms.length)];
    const { speakerIds, liarIds } = castRound({ advisors: ADVISORS, slots, mode: 'lottery', rng });
    const wrong = room.choices.filter((c) => c.id !== room.correct);
    const hints = speakerIds.map((id) => {
      const target = liarIds.includes(id) ? wrong[Math.floor(rng() * wrong.length)].id : room.correct;
      return { id, text: writeHint({ choices: room.choices, target, rng }) };
    });
    const opened = hints.slice().sort(() => rng() - 0.5).slice(0, Math.min(K, hints.length));
    if (decide(room, opened) === room.correct) alive++;
  }
  return alive / n * 100;
}

console.log('外し型を減らしたあと。開封数 K ごとの1部屋あたり生存率\n');
console.log('発言枠 嘘つき     K=1    K=2    K=3    K=4    K=5');
for (const slots of [8, 7, 6, 5, 4, 3]) {
  const L = liarCountFor(Math.min(slots, 12));
  const row = [1, 2, 3, 4, 5].map((K) => (K > slots ? '  --  ' : rate(slots, K).toFixed(1).padStart(5) + '%'));
  console.log(`${String(slots).padStart(4)}人 ${String(L).padStart(4)}人  ${row.join(' ')}`);
}
console.log('\n狙い：区画1で 85% 前後、区画4で 75% 前後');
