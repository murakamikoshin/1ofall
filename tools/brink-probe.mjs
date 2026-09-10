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
  // 黙らせて当たった相手は「確定で嘘つき」。人間はこれを覚えて使う
  let known = new Set();
  let section = -1;
  engine.start();

  for (let guard = 0; guard < 400; guard++) {
    const s = engine.snapshot();
    if (s.phase === 'gameover' || s.phase === 'cleared') break;
    if (s.phase !== 'choosing' || !s.round) { engine.advancePresentation(); continue; }

    await tick();
    const round = s.round;
    // 区画が変わると顔ぶれごと入れ替わるので、確定した相手も忘れる
    if (round.sectionIndex !== section) { section = round.sectionIndex; known = new Set(); }
    const rowsOf = () => (engine.snapshot().round?.advice ?? []).map((a) => ({
      advisorId: a.advisorId, text: a.text, record: a.record,
    }));

    // 一番信用できない発言者を黙らせる。当たれば嘘つきが一人消える
    if (useProbe && !round.silenceUsed) {
      const rows = rowsOf();
      const fresh = rows.filter((r) => !known.has(r.advisorId));
      if (fresh.length > 0) {
        let worst = fresh[0];
        for (const r of fresh) if (C.trustOf(r.record) < C.trustOf(worst.record)) worst = r;
        const result = engine.silence(worst.advisorId);
        if (result) { probes++; if (result.hit) { hits++; known.add(worst.advisorId); } }
      }
    }

    const after = engine.snapshot().round;
    if (!after) break;
    // 確定した嘘つきの言葉は信用しない（実際には黙っているが、区画をまたぐ前の発言も含めて割り引く）
    const rows = rowsOf().map((r) => (known.has(r.advisorId) ? { ...r, record: { hit: 0, miss: 9 } } : r));
    const score = C.scoreChoices({ choices: after.room.choices, rows, own: null });
    engine.choose(C.bestChoice(score, after.room.choices, rng));
    rooms++;
    const v = engine.snapshot().verdict;
    if (v && !v.survived) deaths++;
    for (let i = 0; i < 4; i++) engine.advancePresentation();
  }
  const final = engine.snapshot();
  return { rooms, deaths, probes, hits, cleared: final.phase === 'cleared' };
}

function brinkMode() {
  const b = C.MODES.brink;
  const slots = Number(process.env.SLOTS ?? b.slotsBySection[0]);
  return {
    ...b,
    lives: Number(process.env.LIVES ?? b.lives),
    roomsPerSection: Number(process.env.PER_SECTION ?? b.roomsPerSection),
    slotsBySection: [slots, slots, slots, slots],
  };
}

const m = brinkMode();
console.log(`崖っぷち　${RUNS}周　命${m.lives} ${m.sections}区画×${m.roomsPerSection} 発言枠${m.slotsBySection[0]}\n`);
for (const [name, useProbe] of [['黙らせるを使わない', false], ['黙らせるを使う', true]]) {
  let rooms = 0, deaths = 0, probes = 0, hits = 0, cleared = 0;
  for (let i = 0; i < RUNS; i++) {
    const r = await play(brinkMode(), useProbe, 5000 + i);
    rooms += r.rooms; deaths += r.deaths; probes += r.probes; hits += r.hits;
    cleared += r.cleared ? 1 : 0;
  }
  const perRoom = 1 - deaths / Math.max(1, rooms);
  console.log(`  ${name.padEnd(18, '　')} 1部屋あたり生存 ${(perRoom * 100).toFixed(1)}%　踏破 ${(cleared / RUNS * 100).toFixed(1)}%　1周 ${(rooms / RUNS).toFixed(1)}部屋`);
  if (probes) console.log(`     黙らせた回数 ${(probes / RUNS).toFixed(1)}回/周　当たり ${(hits / probes * 100).toFixed(0)}%`);
}
