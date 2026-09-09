/** 実物のロジックで1周を通しで回し、長さを測る */
import { build } from 'esbuild';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { readFileSync } from 'node:fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(tmpdir(), `core10-${process.pid}.mjs`);
await build({
  stdin: { contents: `export * from './src/core/casting';
                      export * from './src/core/hint-writer';
                      export * from './src/core/limits';
                      export * from './src/core/rng';`, resolveDir: root, loader: 'ts' },
  bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent',
});
const { castRound, writeHint, openLimitFor, RUN, createRng, shuffled } = await import(pathToFileURL(out).href);
const pack = JSON.parse(readFileSync(resolve(root, 'data/rooms.core.json'), 'utf8'));
const rng = createRng(2468);
const SEC_PER_ROOM = Number(process.argv[2] ?? 38);

function makeAdvisors(n) {
  return Array.from({ length: n }, (_, i) => ({ id: `ai_${i}`, name: `a${i}`, kind: 'ai' }));
}

function decide(room, hints, skill) {
  const score = new Map(room.choices.map((c) => [c.id, 0]));
  for (const { text } of hints) {
    for (const c of room.choices) {
      if (!text.includes(c.label)) continue;
      score.set(c.id, (score.get(c.id) ?? 0) + (/やめろ|罠|手を出すな|死ぬぞ/.test(text) ? -1 : 1));
    }
  }
  const max = Math.max(...score.values());
  const top = [...score].filter(([, v]) => v === max).map(([id]) => id);
  // skill: 割れたときに正解を見抜ける確率
  if (top.length > 1 && rng() < skill && top.includes(room.correct)) return room.correct;
  return top[Math.floor(rng() * top.length)];
}

function playRoom(room, slots, advisors, skill) {
  const { speakerIds, liarIds } = castRound({ advisors, slots, mode: 'lottery', rng });
  const wrong = room.choices.filter((c) => c.id !== room.correct);
  const hints = speakerIds.map((id) => {
    const target = liarIds.includes(id) ? wrong[Math.floor(rng() * wrong.length)].id : room.correct;
    return { id, text: writeHint({ choices: room.choices, target, rng }) };
  });
  const limit = openLimitFor(speakerIds.length);
  const opened = shuffled(hints, rng).slice(0, limit);
  return decide(room, opened, skill) === room.correct;
}

function run(advisorCount, skill) {
  const advisors = makeAdvisors(advisorCount);
  let lives = RUN.lives, section = 0, clearedInSection = 0, attempts = 0, total = 0;
  let deck = shuffled(pack.rooms, rng);

  while (lives > 0 && section < RUN.sections) {
    const want = RUN.minChoicesBySection[section] ?? 5;
    let i = deck.findIndex((r) => r.choices.length >= want);
    if (i < 0) i = 0;
    const room = deck.splice(i, 1)[0];
    if (!room) break;

    attempts++;
    const slots = RUN.slotsBySection[section] ?? 5;
    if (playRoom(room, slots, advisors, skill)) {
      clearedInSection++; total++;
      if (clearedInSection >= RUN.roomsPerSection) { section++; clearedInSection = 0; }
    } else {
      lives--;
      total -= clearedInSection; clearedInSection = 0;
    }
  }
  return { attempts, total, cleared: section >= RUN.sections };
}

console.log(`1周 = ${RUN.sections}区画 × ${RUN.roomsPerSection}部屋 / 命${RUN.lives} / 発言枠 ${RUN.slotsBySection.join('→')}`);
console.log(`1部屋 ${SEC_PER_ROOM} 秒として\n`);
console.log('助言者数  腕前   挑戦部屋  到達  全踏破   1周');
for (const [n, skill] of [[12, 0], [12, 0.3], [12, 0.6], [7, 0.3], [5, 0.3], [4, 0.3]]) {
  let att = 0, tot = 0, win = 0;
  const N = 20000;
  for (let i = 0; i < N; i++) {
    const r = run(n, skill);
    att += r.attempts; tot += r.total; if (r.cleared) win++;
  }
  const a = att / N;
  console.log(
    `${String(n).padStart(6)}人 ${(skill*100).toFixed(0).padStart(4)}%  ${a.toFixed(1).padStart(7)}  ` +
    `${(tot/N).toFixed(1).padStart(5)}  ${(win/N*100).toFixed(0).padStart(5)}%  ${(a*SEC_PER_ROOM/60).toFixed(1).padStart(5)}分`
  );
}
