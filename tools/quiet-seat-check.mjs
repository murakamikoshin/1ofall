/**
 * 黙っている席が明け渡されるか。
 *
 * 配信で1000人が見ていると、発言枠は8。抽選で当たった人が
 * **繋がったまま一言も書かない**と、その席は区画のあいだ（4〜5部屋）
 * 空席のまま残る。挑戦者の聞く声が減り、書きたい人は座れない。
 *
 * 抜けた人（線が切れた人）は席ごと AI が引き取る仕組みが前からある。
 * ここで見るのは「居るのに黙っている人」。
 *
 *   1. 区画のあいだ黙っていた人は、次の区画で薄く引かれる
 *   2. ただし外されるのではない（確定で落とすと、書けない人が二度と座れない）
 *   3. 書いた人は薄くならない
 */
import { build } from 'esbuild';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { readFileSync } from 'node:fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(tmpdir(), `quiet-${process.pid}-${Date.now()}.mjs`);
await build({
  stdin: { contents: `export * from './src/core/engine';
    export * from './src/core/limits';
    export { setLocale, localized } from './src/i18n';`, resolveDir: root, loader: 'ts' },
  bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent',
});
const C = await import(pathToFileURL(out).href);
C.setLocale('ja');
const pack = JSON.parse(readFileSync(resolve(root, 'data/rooms.core.json'), 'utf8'));

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  ${detail}`}`);
};

/**
 * 20人の助言者のうち、決めた人だけが喋る供給源。
 * 人間の場を模す（AI の供給源は全員が必ず喋るので、この形は作れない）。
 */
function makeGateway(quietIds) {
  const roster = Array.from({ length: 20 }, (_, i) => ({
    id: `p${i}`, name: `名${i}`, kind: 'human',
  }));
  const hintListeners = new Set();
  let current = null;
  // 供給源には正解が配られる（そこにしか無い）。検査はそれを借りて確実に抜ける
  const state = { correctId: null };
  return {
    kind: 'human',
    roster: () => roster,
    peekCorrect: () => state.correctId,
    openRound(briefing) {
      current = briefing;
      state.correctId = briefing.room.correct;
      // 黙っている人以外は、その部屋で一言書く
      for (const id of briefing.casting.speakerIds) {
        if (quietIds.has(id)) continue;
        const label = briefing.room.choices[0]?.label?.ja ?? '扉';
        for (const l of hintListeners) {
          l({ advisorId: id, roundId: briefing.roundId, text: `${label}だと思う`, sentAt: Date.now() });
        }
      }
    },
    closeRound() { current = null; },
    onHint(l) { hintListeners.add(l); return () => hintListeners.delete(l); },
    onRosterChange() { return () => {}; },
    volunteers: () => [],
    dispose() { hintListeners.clear(); void current; },
  };
}

/** 一周まわして、区画ごとの発言枠を集める */
function runSections(quietIds, seed) {
  const gateway = makeGateway(quietIds);
  const engine = new C.GameEngine({ pack, gateway, mode: C.MODES.standard, seed });
  const casts = [];
  engine.start();
  for (let r = 0; r < 40; r++) {
    const s = engine.snapshot();
    if (s.phase === 'gameover' || s.phase === 'cleared' || !s.round) break;
    const section = s.round.sectionIndex;
    if (!casts[section]) casts[section] = new Set(s.round.speakers.map((x) => x.id));
    // 正解を選び続ける。死ぬと区画をやり直すので、区画をまたげない
    const correctId = gateway.peekCorrect() ?? s.round.room.choices[0].id;
    engine.choose(correctId);
    for (let i = 0; i < 4; i++) engine.advancePresentation();
  }
  return casts.filter(Boolean);
}

const quiet = new Set(['p0', 'p1', 'p2']);
let quietSeats = 0, quietChances = 0, loudSeats = 0, loudChances = 0;
let seenSections = 0;
for (let seed = 1; seed <= 60; seed++) {
  const casts = runSections(quiet, seed);
  if (casts.length < 2) continue;
  seenSections += casts.length - 1;
  // 2区画目以降が「前の区画で黙っていた人を薄く引くか」の場
  for (let i = 1; i < casts.length; i++) {
    const prev = casts[i - 1];
    for (const id of quiet) {
      if (!prev.has(id)) continue;
      quietChances++;
      if (casts[i].has(id)) quietSeats++;
    }
    for (const id of ['p5', 'p6', 'p7']) {
      if (!prev.has(id)) continue;
      loudChances++;
      if (casts[i].has(id)) loudSeats++;
    }
  }
}

const quietRate = quietChances ? quietSeats / quietChances : 0;
const loudRate = loudChances ? loudSeats / loudChances : 0;
console.log(`\n区画の境目 ${seenSections} 回`);
console.log(`  黙っていた人が続けて座った率  ${(quietRate * 100).toFixed(1)}%（${quietSeats}/${quietChances}）`);
console.log(`  書いた人が続けて座った率      ${(loudRate * 100).toFixed(1)}%（${loudSeats}/${loudChances}）`);
check('境目を見られている', quietChances >= 10 && loudChances >= 10, `${quietChances} / ${loudChances}`);
check('黙っていた席は薄く引かれる', quietRate < loudRate * 0.7,
  `${(quietRate * 100).toFixed(1)}% vs ${(loudRate * 100).toFixed(1)}%`);
check('外されはしない（座り直せる）', quietSeats > 0, `${quietSeats}回`);

console.log(`\n${pass} 通過 / ${fail} 失敗`);
process.exit(fail > 0 ? 1 : 0);
