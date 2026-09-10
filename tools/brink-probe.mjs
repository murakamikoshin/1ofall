/**
 * 崖っぷちで「黙らせる」を使うと生存率がどう変わるか。
 *
 * ルーブリックの打ち手は助言を読むだけで、このモードの探す道具を使っていない。
 * 「信じられる一人を探す」遊びなのだから、道具を使った数字も見ないと
 * 難易度の話ができない。
 */
import { build } from 'esbuild';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(tmpdir(), `probe-${process.pid}.mjs`);
await build({
  stdin: { contents: `
    export { GameEngine } from './src/core/engine';
    export { AiAdvisorGateway } from './src/core/ai-advisors';
    export { corePackage } from './src/core/pack';
    export { MODES } from './src/core/limits';
    export { scoreChoices, bestChoice, trustOf } from './src/core/read-hints';
    export { setLocale, localized } from './src/i18n';
    export { createRng } from './src/core/rng';
  `, resolveDir: root, loader: 'ts' },
  bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent',
});
const C = await import(pathToFileURL(out).href);
C.setLocale(process.env.LOCALE ?? 'ja');

const RUNS = Number(process.env.RUNS ?? 400);
const rng = C.createRng(Number(process.env.SEED ?? 7));

const tick = () => new Promise((r) => setTimeout(r, 0));

async function play(mode, useProbe, seed) {
  const engine = new C.GameEngine({
    pack: C.corePackage(), mode,
    // 助言は時間差で届く。待たないと「助言ゼロで選んだ」ことになる
    gateway: new C.AiAdvisorGateway({ count: 12, mode, minDelayMs: 0, maxDelayMs: 0 }),
    seed,
  });
  let rooms = 0, deaths = 0, probes = 0, hits = 0;
  engine.start();

  for (let guard = 0; guard < 400; guard++) {
    const s = engine.snapshot();
    if (s.phase === 'gameover' || s.phase === 'cleared') break;
    if (s.phase !== 'choosing' || !s.round) { engine.advancePresentation(); continue; }

    await tick();
    const round = s.round;
    const rowsOf = () => (engine.snapshot().round?.advice ?? []).map((a) => ({
      advisorId: a.advisorId, text: a.text, record: a.record,
    }));

    // 一番信用できない発言者を黙らせる。当たれば嘘つきが一人消える
    if (useProbe && !round.silenceUsed) {
      const rows = rowsOf();
      if (rows.length > 0) {
        let worst = rows[0];
        for (const r of rows) if (C.trustOf(r.record) < C.trustOf(worst.record)) worst = r;
        const result = engine.silence(worst.advisorId);
        if (result) { probes++; if (result.hit) hits++; }
      }
    }

    const after = engine.snapshot().round;
    if (!after) break;
    const score = C.scoreChoices({ choices: after.room.choices, rows: rowsOf(), own: null });
    engine.choose(C.bestChoice(score, after.room.choices, rng));
    rooms++;
    const v = engine.snapshot().verdict;
    if (v && !v.survived) deaths++;
    for (let i = 0; i < 4; i++) engine.advancePresentation();
  }
  const final = engine.snapshot();
  return { rooms, deaths, probes, hits, cleared: final.phase === 'cleared' };
}

console.log(`崖っぷち　${RUNS}周\n`);
for (const [name, useProbe] of [['黙らせるを使わない', false], ['黙らせるを使う', true]]) {
  let rooms = 0, deaths = 0, probes = 0, hits = 0, cleared = 0;
  for (let i = 0; i < RUNS; i++) {
    const r = await play(C.MODES.brink, useProbe, 5000 + i);
    rooms += r.rooms; deaths += r.deaths; probes += r.probes; hits += r.hits;
    cleared += r.cleared ? 1 : 0;
  }
  const perRoom = 1 - deaths / Math.max(1, rooms);
  console.log(`  ${name.padEnd(18, '　')} 1部屋あたり生存 ${(perRoom * 100).toFixed(1)}%　踏破 ${(cleared / RUNS * 100).toFixed(1)}%　1周 ${(rooms / RUNS).toFixed(1)}部屋`);
  if (probes) console.log(`     黙らせた回数 ${(probes / RUNS).toFixed(1)}回/周　当たり ${(hits / probes * 100).toFixed(0)}%`);
}
