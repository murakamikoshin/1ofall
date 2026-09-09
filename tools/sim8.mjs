/**
 * 実物の castRound / writeHint をそのまま使って、大量に回す。
 * ブラウザでの通しプレイは1周1分かかるので、細かい調整はここでやる。
 */
import { build } from 'esbuild';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { readFileSync } from 'node:fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(tmpdir(), `core-${process.pid}.mjs`);
await build({
  stdin: {
    contents: `export * from './src/core/casting';
               export * from './src/core/hint-writer';
               export * from './src/core/limits';
               export * from './src/core/rng';`,
    resolveDir: root, loader: 'ts',
  },
  bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent',
});
const { castRound, writeHint, liarCountFor, openLimitFor, liarBias, createRng } =
  await import(pathToFileURL(out).href);

const pack = JSON.parse(readFileSync(resolve(root, 'data/rooms.core.json'), 'utf8'));
const rng = createRng(12345);

const ADVISORS = Array.from({ length: 12 }, (_, i) => ({ id: `ai_${i}`, name: `a${i}`, kind: 'ai' }));

/** 素朴な打ち手：押しは+1、外しは-1。一番高いものを選ぶ */
function decide(room, hints) {
  const score = new Map(room.choices.map((c) => [c.id, 0]));
  for (const { text } of hints) {
    for (const c of room.choices) {
      if (!text.includes(c.label)) continue;
      const negative = /やめろ|罠|手を出すな|死ぬぞ/.test(text);
      score.set(c.id, (score.get(c.id) ?? 0) + (negative ? -1 : 1));
    }
  }
  const max = Math.max(...score.values());
  const top = [...score].filter(([, v]) => v === max).map(([id]) => id);
  return top[Math.floor(rng() * top.length)];
}

function playRoom(room, slots) {
  const { speakerIds, liarIds } = castRound({ advisors: ADVISORS, slots, mode: 'lottery', rng });
  const wrong = room.choices.filter((c) => c.id !== room.correct);
  const hints = speakerIds.map((id) => {
    const liar = liarIds.includes(id);
    const decoy = wrong[Math.floor(rng() * wrong.length)];
    const target = liar ? decoy.id : room.correct;
    return { id, text: writeHint({ choices: room.choices, target, rng }) };
  });
  const limit = openLimitFor(liarCountFor(speakerIds.length));
  // 開く相手はランダム（腕前の下限）
  const opened = hints.slice().sort(() => rng() - 0.5).slice(0, limit);
  return decide(room, opened) === room.correct;
}

function rateForSlots(slots, n = 40000) {
  let alive = 0;
  for (let i = 0; i < n; i++) {
    const room = pack.rooms[Math.floor(rng() * pack.rooms.length)];
    if (playRoom(room, slots)) alive++;
  }
  return alive / n * 100;
}

console.log('実物のロジックでの1部屋あたり生存率（開く相手はランダム＝腕前の下限）\n');
console.log('発言枠  嘘つき  開封   生存率');
for (const slots of [8, 7, 6, 5, 4]) {
  const S = Math.min(slots, ADVISORS.length);
  const L = liarCountFor(S);
  console.log(`${String(slots).padStart(4)}人 ${String(L).padStart(5)}人 ${String(openLimitFor(L)).padStart(4)}通  ${rateForSlots(slots).toFixed(1).padStart(5)}%`);
}

console.log('\n嘘の癖の分布（id から決まる。1.0 が平均的）');
console.log(ADVISORS.map((a) => `${a.id}:${liarBias(a.id).toFixed(2)}`).join('  '));

// 助言の言い回しの内訳。押しが少ないと情報量が落ちる
const room = pack.rooms[0];
const counts = { 押し: 0, 曖昧: 0, 外し: 0 };
for (let i = 0; i < 20000; i++) {
  const t = writeHint({ choices: room.choices, target: room.correct, rng });
  const correctLabel = room.choices.find((c) => c.id === room.correct).label;
  if (/やめろ|罠|手を出すな|死ぬぞ/.test(t)) counts.外し++;
  else if (/たぶん|に見える|じゃないか/.test(t)) counts.曖昧++;
  else if (t.includes(correctLabel)) counts.押し++;
}
const tot = counts.押し + counts.曖昧 + counts.外し;
console.log('\n助言の言い回しの内訳');
for (const [k, v] of Object.entries(counts)) console.log(`  ${k}: ${(v / tot * 100).toFixed(0)}%`);
