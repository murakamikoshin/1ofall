/**
 * 枠外の票が「当てにならない」かを測る。
 *
 * 配信で1000人いても発言できるのは8人。残りに一票ずつ渡した。
 * ただし当てになってしまうと、票を見るだけで解けるゲームになる。
 *
 * 狙い：**票は罠に集まりやすい。** 枠外にも嘘つきが混ざっていて、
 * 嘘つきは全員が同じ罠に投じ、協力者は候補のどれかに散るため。
 */
import { build } from 'esbuild';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(tmpdir(), `crowd-${process.pid}.mjs`);
await build({
  stdin: { contents: `
    export { GameEngine } from './src/core/engine';
    export { AiAdvisorGateway } from './src/core/ai-advisors';
    export { corePackage } from './src/core/pack';
    export { MODES } from './src/core/limits';
    export { scoreChoices, bestChoice } from './src/core/read-hints';
    export { setLocale, localized } from './src/i18n';
    export { createRng } from './src/core/rng';
  `, resolveDir: root, loader: 'ts' },
  bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent',
});
const C = await import(pathToFileURL(out).href);
C.setLocale(process.env.LOCALE ?? 'ja');

const RUNS = Number(process.env.RUNS ?? 300);
const MODE = process.env.MODE ?? 'standard';
const CROWD = Number(process.env.CROWD ?? 12);
const tick = () => new Promise((r) => setTimeout(r, 0));
const rng = C.createRng(Number(process.env.SEED ?? 5));

/** 打ち手いろいろ。票だけ見る人と、票を無視する人を比べる */
const READERS = {
  '票だけ見る': ({ crowd, choices }) => (crowd[0]?.choiceId ?? choices[0].id),
  '票を無視する': ({ rows, choices }) => C.bestChoice(C.scoreChoices({ choices, rows, own: null }), choices, rng),
  '票も足して読む': ({ rows, choices, crowd }) => {
    const score = C.scoreChoices({ choices, rows, own: null });
    const total = crowd.reduce((a, c) => a + c.votes, 0) || 1;
    for (const c of crowd) score.set(c.choiceId, (score.get(c.choiceId) ?? 0) + (c.votes / total) * 2);
    return C.bestChoice(score, choices, rng);
  },
  '票が集まった扉を避ける': ({ rows, choices, crowd }) => {
    const score = C.scoreChoices({ choices, rows, own: null });
    const total = crowd.reduce((a, c) => a + c.votes, 0) || 1;
    for (const c of crowd) score.set(c.choiceId, (score.get(c.choiceId) ?? 0) - (c.votes / total) * 2);
    return C.bestChoice(score, choices, rng);
  },
  '一番票が多い扉だけ疑う': ({ rows, choices, crowd }) => {
    const score = C.scoreChoices({ choices, rows, own: null });
    const top = crowd[0];
    const total = crowd.reduce((a, c) => a + c.votes, 0) || 1;
    // 票が突出しているときだけ疑う。割れているならただの雑音
    if (top && top.votes / total >= 0.35) score.set(top.choiceId, (score.get(top.choiceId) ?? 0) - 1.5);
    return C.bestChoice(score, choices, rng);
  },
};

async function play(reader, seed) {
  const mode = C.MODES[MODE];
  const engine = new C.GameEngine({
    pack: C.corePackage(), mode, seed,
    gateway: new C.AiAdvisorGateway({ count: 8 + CROWD, mode, minDelayMs: 0, maxDelayMs: 0 }),
  });
  let rooms = 0, deaths = 0, crowdTop = 0, crowdRight = 0;
  engine.start();
  for (let g = 0; g < 300; g++) {
    const s = engine.snapshot();
    if (s.phase === 'gameover' || s.phase === 'cleared') break;
    if (s.phase !== 'choosing' || !s.round) { engine.advancePresentation(); continue; }
    await tick();
    const round = engine.snapshot().round;
    if (!round) break;
    const rows = round.advice.map((a) => ({ advisorId: a.advisorId, text: a.text, record: a.record }));
    const crowd = [...round.crowd];
    engine.choose(reader({ rows, choices: round.room.choices, crowd }));
    rooms++;
    const v = engine.snapshot().verdict;
    if (v) {
      if (!v.survived) deaths++;
      if (crowd.length > 0) {
        crowdTop++;
        if (crowd[0].choiceId === v.correctId) crowdRight++;
      }
    }
    for (let i = 0; i < 4; i++) engine.advancePresentation();
  }
  return { rooms, deaths, crowdTop, crowdRight };
}

console.log(`${MODE}　枠外${CROWD}人　${RUNS}周\n`);
let tally = null;
for (const [name, reader] of Object.entries(READERS)) {
  let rooms = 0, deaths = 0, top = 0, right = 0;
  for (let i = 0; i < RUNS; i++) {
    const r = await play(reader, 9000 + i);
    rooms += r.rooms; deaths += r.deaths; top += r.crowdTop; right += r.crowdRight;
  }
  const surv = 1 - deaths / Math.max(1, rooms);
  console.log(`  ${name.padEnd(12, '　')} 1部屋あたり生存 ${(surv * 100).toFixed(1)}%`);
  if (!tally && top > 0) tally = { top, right };
}
if (tally) {
  console.log(`\n  一番票が集まった扉の的中率  ${(tally.right / tally.top * 100).toFixed(1)}%`);
  console.log('  （高いと票を見るだけで解ける。低いほど「群れの罠」として働く）');
}
