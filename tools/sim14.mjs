/**
 * 実物の writeHint / castLiars / dealKnowledge をそのまま使い、
 * 挑戦者の読み方で結果がどれだけ変わるかを測る。
 */
import { build } from 'esbuild';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { readFileSync } from 'node:fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(tmpdir(), `core14-${process.pid}.mjs`);
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
const rng = createRng(4242);
const ADV = Array.from({ length: 12 }, (_, i) => ({ id: `ai_${i}`, name: `a${i}`, kind: 'ai' }));

const HEDGE_RE = /たぶん|気がする|に見える|じゃないか|絞れた|決めきれん|どっちか/;
const AVOID_RE = /やめろ|死ぬ|手を出すな|罠だ|だけは違う|だめだ/;

/** 読み方いろいろ。weightPush / weightHedge をどう置くか */
function decide(room, hints, wPush, wHedge) {
  const labels = room.choices.map((c) => ({ id: c.id, label: c.label.ja }));
  const score = new Map(labels.map((c) => [c.id, 0]));
  for (const text of hints) {
    const touched = labels.filter((c) => text.includes(c.label));
    // 「これは死ぬ」型は、触れた相手を潰す言い方
    if (AVOID_RE.test(text)) {
      for (const c of touched) score.set(c.id, (score.get(c.id) ?? 0) - 0.9);
      continue;
    }
    const hedging = touched.length >= 2 || HEDGE_RE.test(text);
    for (const c of touched) score.set(c.id, (score.get(c.id) ?? 0) + (hedging ? wHedge : wPush));
  }
  const max = Math.max(...score.values());
  const top = [...score].filter(([, v]) => v === max).map(([id]) => id);
  return top[Math.floor(rng() * top.length)];
}

function runSection(slots, rooms, wPush, wHedge, mix) {
  const speakerIds = castSpeakers({ advisors: ADV, slots, mode: 'lottery', rng });
  const liarIds = castLiars(speakerIds, rng);
  let alive = 0;
  for (let r = 0; r < rooms; r++) {
    const room = pack.rooms[Math.floor(rng() * pack.rooms.length)];
    const knowledge = dealKnowledge(room.choices, room.correct, { speakerIds, liarIds }, rng, mix);
    const hints = speakerIds.map((id) => {
      const honesty = 0.55 - Math.min(0.4, liarBias(id) * 0.16);
      return writeHint({ choices: room.choices, knowledge: knowledge.get(id), rng,
                         liarHonestyRate: honesty, voice: voiceOf(id) });
    });
    if (decide(room, hints, wPush, wHedge) === room.correct) alive++;
  }
  return alive / rooms;
}

function measure(label, wPush, wHedge, trials = 4000) {
  const perSlot = {};
  RUN.slotsBySection.forEach((slots, i) => {
    const mix = RUN.knowledgeBySection[i];
    let s = 0;
    for (let t = 0; t < trials; t++) s += runSection(slots, 6, wPush, wHedge, mix);
    perSlot[`区画${i + 1}(${slots}人)`] = (s / trials * 100);
  });
  const avg = Object.values(perSlot).reduce((a, b) => a + b, 0) / 4;
  console.log(
    `${label.padEnd(34)} ` +
    Object.entries(perSlot).map(([k, v]) => `${k} ${v.toFixed(0)}%`).join('  ') +
    `   平均 ${avg.toFixed(1)}%`
  );
  return avg;
}

console.log('挑戦者の読み方による差（実物の助言文で測定）\n');
console.log('読み方                              区画ごと                      平均');
measure('票を数えない（当てずっぽう相当）', 0, 0);
measure('断言を重く見る（素朴・設計と逆）', 1.0, 0.7);
measure('区別しない', 1.0, 1.0);
measure('迷いを重く見る（設計どおり）', 0.45, 1.0);
measure('断言を強く疑う', 0.2, 1.0);

/* ── 1周の長さ ─────────────────────────────────────────── */
function fullRun(wPush, wHedge) {
  let lives = RUN.lives, section = 0, attempts = 0, cleared = 0;
  while (lives > 0 && section < RUN.sections) {
    const slots = RUN.slotsBySection[section];
    const mix = RUN.knowledgeBySection[section];
    const speakerIds = castSpeakers({ advisors: ADV, slots, mode: 'lottery', rng });
    const liarIds = castLiars(speakerIds, rng);
    let inSection = 0;
    while (inSection < RUN.roomsPerSection && lives > 0) {
      const room = pack.rooms[Math.floor(rng() * pack.rooms.length)];
      const knowledge = dealKnowledge(room.choices, room.correct, { speakerIds, liarIds }, rng, mix);
      const hints = speakerIds.map((id) => {
        const honesty = 0.55 - Math.min(0.4, liarBias(id) * 0.16);
        return writeHint({ choices: room.choices, knowledge: knowledge.get(id), rng,
                         liarHonestyRate: honesty, voice: voiceOf(id) });
      });
      attempts++;
      if (decide(room, hints, wPush, wHedge) === room.correct) { inSection++; cleared++; }
      else { lives--; cleared -= inSection; inSection = 0; }
    }
    if (inSection >= RUN.roomsPerSection) section++;
  }
  return { attempts, cleared, done: section >= RUN.sections };
}

console.log('\n1周の長さ（1部屋38秒として）');
console.log('読み方                          挑戦部屋  全踏破   1周');
for (const [label, wP, wH] of [
  ['素朴（断言を重く見る）', 1.0, 0.7],
  ['区別しない', 1.0, 1.0],
  ['設計どおり（迷いを重く見る）', 0.45, 1.0],
]) {
  let att = 0, win = 0; const N = 6000;
  for (let i = 0; i < N; i++) { const r = fullRun(wP, wH); att += r.attempts; if (r.done) win++; }
  const a = att / N;
  console.log(`${label.padEnd(28)} ${a.toFixed(1).padStart(6)}  ${(win / N * 100).toFixed(0).padStart(5)}%  ${(a * 38 / 60).toFixed(1).padStart(5)}分`);
}
